        document.addEventListener('DOMContentLoaded', () => {
            // [PWA] Service Worker Registration
            if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                    navigator.serviceWorker.register('./service-worker.js')
                        .then(registration => console.log('ServiceWorker registration successful'))
                        .catch(err => console.log('ServiceWorker registration failed: ', err));
                });
            }

            const App = {
                currentUser: null,
                data: { users: [], products: [], sales: [], stockIns: [], stockOuts: [], stores: [], backupPassword: null },
                cart: [],
                summaryContext: {},
                editingSaleContext: null,
                editingStockInId: null,
                editingStockOutId: null,

                // --- INITIALIZATION ---
                init() {
                    this.loadData();
                    // Note: fillPages is still needed as it injects all dynamic HTML structure
                    this.fillPages(); 
                    this.attachEventListeners();
                    this.checkLoginState();
                },

                // --- UTILITY & FORMATTING HELPERS ---
                formatNumberSmart(num) {
                    if (typeof num !== 'number' || isNaN(num)) return num;
                    if (num % 1 === 0) {
                        return num.toLocaleString('th-TH');
                    } else {
                        return num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    }
                },
                formatThaiDateShortYear(dateStr) {
                    if (!dateStr) return '-';
                    try {
                        const date = new Date(dateStr);
                        const day = String(date.getDate()).padStart(2, '0');
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const year = (date.getFullYear() + 543).toString().slice(-2);
                        return `${day}/${month}/${year}`;
                    } catch (e) {
                        console.error("Date formatting error:", e);
                        return '-';
                    }
                },
                formatThaiDateFullYear(dateStr) {
                    if (!dateStr) return '-';
                    try {
                        const date = new Date(dateStr);
                        const day = String(date.getDate()).padStart(2, '0');
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const year = date.getFullYear() + 543;
                        return `${day}/${month}/${year}`;
                    } catch (e) {
                        console.error("Date formatting error:", e);
                        return '-';
                    }
                },
                formatThaiTimestamp(date) {
                    if (!(date instanceof Date)) {
                        date = new Date(date);
                    }
                    if (isNaN(date)) return '-';

                    const day = String(date.getDate()).padStart(2, '0');
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const year = date.getFullYear() + 543;
                    const dateString = `${day}/${month}/${year}`;

                    const timeString = date.toLocaleTimeString('th-TH', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    });

                    return `วันที่ ${dateString} เวลา ${timeString} น.`;
                },

                // --- CRYPTO HELPER FUNCTIONS (FOR ENCRYPTION/DECRYPTION) ---
                arrayBufferToBase64(buffer) {
                    let binary = '';
                    const bytes = new Uint8Array(buffer);
                    const len = bytes.byteLength;
                    for (let i = 0; i < len; i++) {
                        binary += String.fromCharCode(bytes[i]);
                    }
                    return window.btoa(binary);
                },
                base64ToArrayBuffer(base64) {
                    const binary_string = window.atob(base64);
                    const len = binary_string.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        bytes[i] = binary_string.charCodeAt(i);
                    }
                    return bytes.buffer;
                },
                async deriveKey(password, salt) {
                    const enc = new TextEncoder();
                    const keyMaterial = await window.crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']);
                    return window.crypto.subtle.deriveKey({
                        "name": 'PBKDF2',
                        salt: salt,
                        "iterations": 100000,
                        "hash": 'SHA-256'
                    }, keyMaterial, { "name": 'AES-GCM', "length": 256 }, true, ["encrypt", "decrypt"]);
                },
                async encryptData(dataString, password) {
                    const salt = window.crypto.getRandomValues(new Uint8Array(16));
                    const iv = window.crypto.getRandomValues(new Uint8Array(12));
                    const key = await this.deriveKey(password, salt);
                    const enc = new TextEncoder();
                    const encodedData = enc.encode(dataString);
                    const encryptedContent = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, encodedData);
                    return {
                        isEncrypted: true,
                        salt: this.arrayBufferToBase64(salt),
                        iv: this.arrayBufferToBase64(iv),
                        encryptedData: this.arrayBufferToBase64(encryptedContent)
                    };
                },
                async decryptData(encryptedPayload, password) {
                    try {
                        const salt = this.base64ToArrayBuffer(encryptedPayload.salt);
                        const iv = this.base64ToArrayBuffer(encryptedPayload.iv);
                        const data = this.base64ToArrayBuffer(encryptedPayload.encryptedData);
                        const key = await this.deriveKey(password, salt);
                        const decryptedContent = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, data);
                        const dec = new TextDecoder();
                        return dec.decode(decryptedContent);
                    } catch (e) {
                        console.error("Decryption failed:", e);
                        return null;
                    }
                },

                // --- CORE APP & UI MANAGEMENT ---
                toggleSection(sectionId) {
                    const currentlyOpen = document.querySelector('.section-content.active');
                    if (currentlyOpen && currentlyOpen.id !== sectionId) {
                        currentlyOpen.classList.remove('active');
                        currentlyOpen.previousElementSibling.classList.remove('active');
                    }
                    const section = document.getElementById(sectionId);
                    if (section) {
                        const header = section.previousElementSibling;
                        section.classList.toggle('active');
                        header.classList.toggle('active');
                    }
                },
                showPage(pageId, payload = null) {
                    const sellerAllowedPages = ['page-pos', 'page-data'];
                    const section = document.getElementById(pageId);
                    if (!section) return;

                    if (this.currentUser.role === 'seller' && !sellerAllowedPages.includes(pageId)) {
                        this.showToast('คุณไม่มีสิทธิ์เข้าถึงหน้านี้');
                        return;
                    }

                    const wasActive = section.classList.contains('active');

                    if (!wasActive) {
                        const isAdmin = this.currentUser.role === 'admin';
                        document.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? '' : 'none');
                        document.querySelectorAll('.seller-only').forEach(el => el.style.display = !isAdmin ? '' : 'none');
                        switch (pageId) {
                            case 'page-pos': this.renderPos(payload); break;
                            case 'page-products': this.renderProductTable(); break;
                            case 'page-stock-in': this.renderStockIn(); break;
                            case 'page-stock-out': this.renderStockOut(); break;
                            case 'page-sales-history': this.renderSalesHistory(); break;
                            case 'page-reports': this.renderReport(); break;
                            case 'page-summary': this.renderSummaryPage(); break;
                            case 'page-stores': this.renderStoreTable(); break;
                            case 'page-users': this.renderUserTable(); break;
                            case 'page-data':
                                if (this.currentUser.role === 'seller') {
                                    this.renderSellerSalesHistoryWithFilter();
                                } else if (this.currentUser.role === 'admin') {
                                    this.renderBackupPasswordStatus();
                                }
                                break;
                        }
                    }

                    this.toggleSection(pageId);
                },
                showMainApp() {
                    document.getElementById('login-screen').style.display = 'none';
                    document.getElementById('main-app').style.display = 'block';
                    document.getElementById('user-info').textContent = `ผู้ใช้: ${this.currentUser.username} (${this.currentUser.role})`;

                    const storeNameSpan = document.getElementById('store-display-name');
                    if (this.currentUser.role === 'seller' && this.currentUser.storeId) {
                        const store = this.data.stores.find(s => s.id === this.currentUser.storeId);
                        if (store) {
                            storeNameSpan.textContent = `- ${store.name}`;
                        } else {
                            storeNameSpan.textContent = '';
                        }
                    } else {
                        storeNameSpan.textContent = '';
                    }

                    document.querySelectorAll('.section-content.active').forEach(openSection => {
                        openSection.classList.remove('active');
                        openSection.previousElementSibling.classList.remove('active');
                    });
                    this.showPage('page-pos');
                },
                showLoginScreen() { document.getElementById('login-screen').style.display = 'block'; document.getElementById('main-app').style.display = 'none'; },
                showToast(message, type = 'success') {
                    const toast = document.getElementById('toast-notification');
                    if (!toast) return;
                    toast.textContent = message;
                    toast.style.backgroundColor = type === 'error' ? 'var(--danger-color)' : (type === 'warning' ? 'var(--warning-color)' : 'var(--success-color)');
                    toast.className = 'show';
                    setTimeout(() => {
                        toast.className = toast.className.replace('show', '');
                    }, 3000);
                },
                openSummaryModal(htmlContent) {
                    const modal = document.getElementById('summaryModal');
                    const modalBody = document.getElementById('modalBodyContent');
                    modalBody.innerHTML = htmlContent;
                    modal.style.display = 'flex';
                    this.setupSummaryPopupControls(); // Setup controls every time modal opens
                },
    setupSummaryPopupControls() {
                    const modalContentContainer = document.querySelector("#summaryModal .modal-content-container");
                    const modalBody = document.getElementById("modalBodyContent");
                    if (!modalBody || !modalContentContainer) return;

                    // --- Font Size Controls ---
                    const textElements = modalBody.querySelectorAll('p, h2, h3, h4, strong, th, td, span, div');
                    const fsSlider = document.getElementById("summaryFontSizeSlider");
                    const fsValueSpan = document.getElementById("summaryFontSizeValue");

                    textElements.forEach(el => {
                        if (!el.dataset.originalSize) {
                            el.dataset.originalSize = parseFloat(window.getComputedStyle(el).fontSize);
                        }
                    });

                    const updateFontSize = () => {
                        const scale = fsSlider.value;
                        textElements.forEach(el => {
                            const originalSize = parseFloat(el.dataset.originalSize);
                            if (originalSize) {
                                el.style.fontSize = (originalSize * scale) + 'px';
                            }
                        });
                        fsValueSpan.textContent = "ขนาด: " + Math.round(scale * 100) + "%";
                    };
                    fsSlider.removeEventListener("input", updateFontSize); // Prevent duplicate listeners
                    fsSlider.addEventListener("input", updateFontSize);

                    // --- Line Height Controls ---
                    const lhSlider = document.getElementById("summaryLineHeightSlider");
                    const lhValueSpan = document.getElementById("summaryLineHeightValue");

                    const updateLineHeight = () => {
                        const lineHeight = lhSlider.value;
                        modalBody.style.lineHeight = lineHeight;
                        lhValueSpan.textContent = "ความสูงของบรรทัด: " + lineHeight;
                    };
                    lhSlider.removeEventListener("input", updateLineHeight);
                    lhSlider.addEventListener("input", updateLineHeight);

                    // --- Save as Image Button Logic ---
                    const saveBtn = document.getElementById("saveSummaryAsImageBtn");
                    // Clone to remove old listeners before re-attaching
                    const newSaveBtn = saveBtn.cloneNode(true); 
                    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

  newSaveBtn.addEventListener("click", () => {
                        // 1. ระบุ Element และเตรียมการ
                        const pinkFrame = modalBody; // กำหนดให้ modalBodyContent เป็น Element เป้าหมาย
                        if (!pinkFrame) {
                            this.showToast('ไม่พบเนื้อหาสรุปสำหรับบันทึก', 'error');
                            return;
                        }

                        const controlsElement = modalContentContainer.querySelector('.modal-controls');
                        if (controlsElement) controlsElement.style.display = 'none';

                        // บันทึก style เดิมของ modalBody และ modalContentContainer
                        const originalStyles = {
                            modalContentContainerMargin: modalContentContainer.style.margin,
                            modalContentContainerBoxSizing: modalContentContainer.style.boxSizing,
                            modalContentContainerMaxWidth: modalContentContainer.style.maxWidth,
                            modalBodyMaxHeight: pinkFrame.style.maxHeight,
                            modalBodyOverflowY: pinkFrame.style.overflowY,
                            modalBodyBoxSizing: pinkFrame.style.boxSizing,
                            modalBodyPadding: pinkFrame.style.padding
                        };

                        // 2. ปรับ Style เพื่อให้แน่ใจว่า Canvas จับภาพได้ทั้งหมด (อ้างอิงหลักการจากไฟล์ 01.txt)
                        // Note: ไฟล์ 01.txt ใช้การปรับ margin และ content-box เพื่อเพิ่มขอบขาว
                        // ในโค้ดใหม่ เราจะเน้นที่การยกเลิกข้อจำกัดด้านความสูงและการ Scroll

                        // ยกเลิกข้อจำกัดความสูงและการ Scroll เพื่อจับภาพเต็ม
                        pinkFrame.style.maxHeight = 'none';
                        pinkFrame.style.overflowY = 'visible';
                        pinkFrame.style.boxSizing = 'content-box';
                        
                        // ปรับให้กรอบนอกกว้างเต็มที่เพื่อรองรับเนื้อหา
                        modalContentContainer.style.maxWidth = 'none';
                        modalContentContainer.style.margin = '2px';
                        modalContentContainer.style.boxSizing = 'content-box';

                        // 3. ใช้ html2canvas แปลง Element เป็น Canvas
                        html2canvas(pinkFrame, { // จับภาพที่ modalBodyContent
                            scale: 2, // ลด scale ลงเพื่อความเร็วในการประมวลผล แต่ยังคงคุณภาพ
                            useCORS: true,
                            allowTaint: true,
                            backgroundColor: '#FAFAD2', // ใช้สีพื้นหลังตามที่กำหนดในโค้ดเดิม
                            logging: false
                        }).then(canvas => {
                            // 4. สร้าง Canvas ใหม่เพื่อเพิ่มขอบสีขาวรอบๆ ภาพ (ตามหลักการไฟล์ 01.txt)
                            const finalCanvas = document.createElement('canvas');
                            const finalCtx = finalCanvas.getContext('2d');
                            const borderSize = 2; // ขอบขาว 2px

                            finalCanvas.width = canvas.width + (borderSize * 2);
                            finalCanvas.height = canvas.height + (borderSize * 2);

                            // วาดพื้นหลังสีขาว
                            finalCtx.fillStyle = '#FFFFFF';
                            finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

                            // วาดภาพที่ได้จาก html2canvas ลงบน Canvas สุดท้าย
                            finalCtx.drawImage(canvas, borderSize, borderSize);

                            // 5. เตรียมชื่อไฟล์และดาวน์โหลด
                            const link = document.createElement('a');
                            const fileName = `POS_Summary_${this.currentUser.username}_${Date.now()}.png`;
                            link.download = fileName;
                            link.href = finalCanvas.toDataURL("image/png");
                            link.click();
                            this.showToast('บันทึกรูปภาพเรียบร้อยแล้ว', 'success');

                        }).catch(err => {
                            console.error("Error creating image:", err);
                            this.showToast("ขออภัย, ไม่สามารถบันทึกเป็นรูปภาพได้: " + err.message, "error");
                        }).finally(() => {
                            // 6. คืนค่า Style เดิมทั้งหมด
                            if (controlsElement) controlsElement.style.display = '';

                            pinkFrame.style.maxHeight = originalStyles.modalBodyMaxHeight;
                            pinkFrame.style.overflowY = originalStyles.modalBodyOverflowY;
                            pinkFrame.style.boxSizing = originalStyles.modalBodyBoxSizing;
                            pinkFrame.style.padding = originalStyles.modalBodyPadding;

                            modalContentContainer.style.margin = originalStyles.modalContentContainerMargin;
                            modalContentContainer.style.boxSizing = originalStyles.modalContentContainerBoxSizing;
                            modalContentContainer.style.maxWidth = originalStyles.modalContentContainerMaxWidth;
                            
                            // คืนค่าสไตล์ที่ตั้งในโค้ดเดิมที่ไม่จำเป็นต้องใช้แล้ว
                            modalContentContainer.style.backgroundColor = '';
                            modalContentContainer.style.padding = '';
                        });
                    });

                    // Initial render
                    updateFontSize();
                    updateLineHeight();
                },
                closeSummaryModal() { document.getElementById('summaryModal').style.display = 'none'; },
                openSummaryOutputModal() { document.getElementById('summaryOutputModal').style.display = 'flex'; },
                closeSummaryOutputModal() { document.getElementById('summaryOutputModal').style.display = 'none'; this.summaryContext = {}; },
                openResetModal() {
                    document.getElementById('reset-sales-checkbox').checked = false;
                    document.getElementById('reset-stockins-checkbox').checked = false;
                    document.getElementById('reset-products-checkbox').checked = false;
                    document.getElementById('reset-sellers-checkbox').checked = false;
                    document.getElementById('reset-stores-checkbox').checked = false;
                    document.getElementById('resetModal').style.display = 'flex';
                },
                closeResetModal() { document.getElementById('resetModal').style.display = 'none'; },

                // --- DATA, AUTH & BACKUP/RESTORE MANAGEMENT ---
                loadData() {
                    try {
                        const data = localStorage.getItem('posData');
                        if (data) {
                            this.data = JSON.parse(data);

                            // --- ROBUST DATA VALIDATION ---
                            if (typeof this.data.backupPassword === 'undefined') this.data.backupPassword = null;
                            if (!this.data.stores || !Array.isArray(this.data.stores)) this.data.stores = [];
                            if (!this.data.stockOuts || !Array.isArray(this.data.stockOuts)) this.data.stockOuts = [];
                            if (!this.data.stockIns || !Array.isArray(this.data.stockIns)) this.data.stockIns = [];
                            if (!this.data.sales || !Array.isArray(this.data.sales)) this.data.sales = [];
                            if (!this.data.products || !Array.isArray(this.data.products)) this.data.products = [];
                            if (!this.data.users || !Array.isArray(this.data.users)) this.data.users = [];

                            if (this.data.users.length === 0) {
                                this.data.users.push({ id: Date.now(), username: 'admin', password: '123', role: 'admin' });
                                this.showToast('ไม่พบข้อมูลผู้ใช้, สร้างบัญชี admin เริ่มต้นให้แล้ว (user: admin, pass: 123)', 'warning');
                            }
                            // --- END: ROBUST DATA VALIDATION ---

                            // --- Data Migration Logic ---
                            this.data.sales.forEach(sale => {
                                sale.items.forEach(item => {
                                    if (typeof item.isSpecialPrice === 'undefined') {
                                        item.isSpecialPrice = false;
                                        item.originalPrice = item.price;
                                    }
                                });
                                if (sale.paymentMethod === 'เครดิต' && typeof sale.creditDueDate === 'undefined') sale.creditDueDate = null;
                                if (typeof sale.transferorName === 'undefined') sale.transferorName = null;
                            });
                            this.data.users.forEach(u => {
                                if (!u.storeId) u.storeId = null;
                                if (u.role === 'seller') {
                                    if (!u.assignedProductIds) u.assignedProductIds = [];
                                    if (typeof u.salesStartDate === 'undefined') u.salesStartDate = null;
                                    if (typeof u.salesEndDate === 'undefined') u.salesEndDate = null;
                                    if (typeof u.commissionRate === 'undefined') u.commissionRate = 0;
                                    if (typeof u.commissionOnCash === 'undefined') u.commissionOnCash = false;
                                    if (typeof u.commissionOnTransfer === 'undefined') u.commissionOnTransfer = false;
                                    if (typeof u.commissionOnCredit === 'undefined') u.commissionOnCredit = false;
                                    if (typeof u.visibleSalesDays === 'undefined') u.visibleSalesDays = null;
                                }
                            });
                        } else {
                            this.data.users.push({ id: Date.now(), username: 'admin', password: '123', role: 'admin' });
                            this.data.backupPassword = null;
                            this.saveData();
                        }
                    } catch (error) {
                        console.error("Fatal error during data load:", error);
                        this.showToast("เกิดข้อผิดพลาดในการโหลดข้อมูล! กำลังรีเซ็ตเป็นค่าเริ่มต้น", "error");
                        this.data = { users: [], products: [], sales: [], stockIns: [], stockOuts: [], stores: [], backupPassword: null };
                        this.data.users.push({ id: Date.now(), username: 'admin', password: '123', role: 'admin' });
                        this.saveData();
                    }
                },
                saveData() { localStorage.setItem('posData', JSON.stringify(this.data)); },
                checkLoginState() {
                    const rememberedUserJson = localStorage.getItem('posCurrentUser');
                    if (rememberedUserJson) {
                        const rememberedUser = JSON.parse(rememberedUserJson);
                        this.currentUser = this.data.users.find(u => u.id === rememberedUser.id);
                        if (this.currentUser) { this.showMainApp(); return; }
                    }
                    const sessionUserJson = sessionStorage.getItem('posCurrentUser');
                    if (sessionUserJson) {
                        const sessionUser = JSON.parse(sessionUserJson);
                        this.currentUser = this.data.users.find(u => u.id === sessionUser.id);
                        if (this.currentUser) { this.showMainApp(); } else { this.logout(); }
                    } else { this.showLoginScreen(); }
                },
                login(username, password) {
                    const user = this.data.users.find(u => u.username === username && u.password === password);
                    if (user) {
                        this.currentUser = user;
                        const rememberMe = document.getElementById('remember-me').checked;
                        sessionStorage.removeItem('posCurrentUser');
                        localStorage.removeItem('posCurrentUser');
                        if (rememberMe) {
                            localStorage.setItem('posCurrentUser', JSON.stringify(this.currentUser));
                        } else {
                            sessionStorage.setItem('posCurrentUser', JSON.stringify(this.currentUser));
                        }
                        this.showMainApp();
                        document.getElementById('login-error').textContent = '';
                    } else {
                        document.getElementById('login-error').textContent = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
                    }
                },
                logout() {
                    this.currentUser = null;
                    sessionStorage.removeItem('posCurrentUser');
                    localStorage.removeItem('posCurrentUser');
                    this.showLoginScreen();
                },
                saveBackupPassword(e) {
                    e.preventDefault();
                    const newPassword = document.getElementById('backup-password').value;
                    const confirmPassword = document.getElementById('backup-password-confirm').value;

                    if (newPassword !== confirmPassword) {
                        this.showToast('รหัสผ่านไม่ตรงกัน กรุณากรอกใหม่อีกครั้ง', 'error');
                        return;
                    }

                    this.data.backupPassword = newPassword.trim() || null;
                    this.saveData();
                    this.showToast('บันทึกรหัสผ่านสำหรับไฟล์สำรองเรียบร้อยแล้ว');
                    document.getElementById('backup-password').value = '';
                    document.getElementById('backup-password-confirm').value = '';
                    this.renderBackupPasswordStatus();
                },
                renderBackupPasswordStatus() {
                    const statusEl = document.getElementById('password-status');
                    if (!statusEl) return;
                    if (this.data.backupPassword) {
                        statusEl.textContent = 'สถานะ: มีการตั้งรหัสผ่านแล้ว';
                        statusEl.style.color = 'var(--success-color)';
                    } else {
                        statusEl.textContent = 'สถานะ: ยังไม่มีการตั้งรหัสผ่าน (ไฟล์สำรองของแอดมินจะไม่ถูกเข้ารหัส)';
                        statusEl.style.color = 'var(--warning-color)';
                    }
                },
                async saveBackupToFile() {
                    const now = new Date();
                    const year = now.getFullYear();
                    const month = String(now.getMonth() + 1).padStart(2, '0');
                    const day = String(now.getDate()).padStart(2, '0');
                    const hours = String(now.getHours()).padStart(2, '0');
                    const minutes = String(now.getMinutes()).padStart(2, '0');
                    const dateTimeString = `${year}${month}${day}_${hours}${minutes}`;
                    const currentUser = this.currentUser.username;
                    const fullFileName = `บันทึกรายการขาย${currentUser}_${dateTimeString}.json`;

                    let dataToSaveString;
                    const backupPassword = this.data.backupPassword;

                    if (backupPassword) {
                        try {
                            this.showToast('กำลังเข้ารหัสข้อมูลด้วยรหัสผ่านของระบบ...', 'warning');
                            const originalDataString = JSON.stringify(this.data, null, 2);
                            const encryptedObject = await this.encryptData(originalDataString, backupPassword);
                            dataToSaveString = JSON.stringify(encryptedObject, null, 2);
                            this.showToast('เข้ารหัสข้อมูลสำเร็จ!', 'success');
                        } catch (error) {
                            console.error("Encryption failed:", error);
                            this.showToast("เกิดข้อผิดพลาดในการเข้ารหัสข้อมูล", "error");
                            return;
                        }
                    } else {
                        this.showToast('บันทึกข้อมูลแบบไม่เข้ารหัส เนื่องจากแอดมินยังไม่ได้ตั้งรหัสผ่านของระบบ', 'warning');
                        dataToSaveString = JSON.stringify(this.data, null, 2);
                    }

                    const blob = new Blob([dataToSaveString], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);

                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fullFileName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    this.showToast(`บันทึกไฟล์ "${fullFileName}" เรียบร้อย`);
                },
                recalculateAllStock() {
                    const totalStockIn = new Map();
                    const totalSold = new Map();
                    const totalStockOut = new Map();

                    this.data.stockIns.forEach(si => {
                        const currentQty = totalStockIn.get(si.productId) || 0;
                        totalStockIn.set(si.productId, currentQty + si.quantity);
                    });

                    this.data.sales.forEach(sale => {
                        sale.items.forEach(item => {
                            const currentQty = totalSold.get(item.productId) || 0;
                            totalSold.set(item.productId, currentQty + item.quantity);
                        });
                    });

                    this.data.stockOuts.forEach(so => {
                        const currentQty = totalStockOut.get(so.productId) || 0;
                        totalStockOut.set(so.productId, currentQty + so.quantity);
                    });

                    this.data.products.forEach(product => {
                        const initialStock = totalStockIn.get(product.id) || 0;
                        const soldQty = totalSold.get(product.id) || 0;
                        const stockOutQty = totalStockOut.get(product.id) || 0;
                        product.stock = initialStock - soldQty - stockOutQty;
                    });
                    console.log("Stock recalculated for all products based on history.");
                },
                // *** เพิ่มฟังก์ชันที่หายไปสำหรับปุ่ม Recalculate ***
                handleRecalculateStock() {
                    if (confirm('คุณแน่ใจหรือไม่ว่าต้องการ "คำนวณสต็อกใหม่ทั้งหมด" ? การกระทำนี้จะใช้ประวัติการนำเข้า/ขาย/ปรับออกทั้งหมด เพื่อกำหนดค่าสต็อกสินค้าปัจจุบันใหม่')) {
                        this.recalculateAllStock();
                        this.saveData();
                        this.showToast('คำนวณสต็อกใหม่ทั้งหมดสำเร็จ!');
                        this.renderStockSummaryReport();
                    }
                },
                _mergeSingleArray(currentArray, newArray, key = 'id') {
                    if (!newArray || !Array.isArray(newArray)) return;
                    const currentIds = new Set(currentArray.map(item => item[key]));
                    
                    newArray.forEach(newItem => {
                        if (!newItem || typeof newItem[key] === 'undefined') return;

                        if (currentIds.has(newItem[key])) {
                            const index = currentArray.findIndex(currentItem => currentItem[key] === newItem[key]);
                            if (index > -1) {
                                currentArray[index] = newItem;
                            }
                        } else {
                            currentArray.push(newItem);
                            currentIds.add(newItem[key]);
                        }
                    });
                },
                mergeData(dataFromFile) {
                    if (dataFromFile.users && Array.isArray(dataFromFile.users)) {
                        const currentAdmin = this.data.users.find(u => u.username === 'admin');
                        const importedAdmin = dataFromFile.users.find(u => u.username === 'admin');
                        if (currentAdmin && importedAdmin) {
                            currentAdmin.password = importedAdmin.password;
                        }
                        const importedSellers = dataFromFile.users.filter(u => u.role !== 'admin');
                        this._mergeSingleArray(this.data.users, importedSellers, 'id');
                    }

                    this._mergeSingleArray(this.data.stores, dataFromFile.stores, 'id');
                    this._mergeSingleArray(this.data.sales, dataFromFile.sales, 'id');
                    this._mergeSingleArray(this.data.stockIns, dataFromFile.stockIns, 'id');
                    this._mergeSingleArray(this.data.stockOuts, dataFromFile.stockOuts, 'id');
                    
                    if (dataFromFile.products && Array.isArray(dataFromFile.products)) {
                        dataFromFile.products.forEach(newProduct => {
                            if (!newProduct || typeof newProduct.id === 'undefined') return;
                            const existingProduct = this.data.products.find(p => p.id === newProduct.id);
                            if (existingProduct) {
                                existingProduct.name = newProduct.name;
                                existingProduct.costPrice = newProduct.costPrice;
                                existingProduct.sellingPrice = newProduct.sellingPrice;
                                existingProduct.unit = newProduct.unit;
                            } else {
                                this.data.products.push(newProduct);
                            }
                        });
                    }
                },
                async promptLoadFromFile(event) {
                    const file = event.target.files[0];
                    if (!file) return;

                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        try {
                            const content = e.target.result;
                            let importedData = JSON.parse(content);
                            let finalDataToMerge = null;

                            if (importedData && importedData.isEncrypted === true) {
                                const adminPassword = this.data.backupPassword;
                                if (!adminPassword) {
                                    this.showToast("ไฟล์นี้ถูกเข้ารหัส แต่คุณยังไม่ได้ตั้งรหัสผ่านในระบบ", "error");
                                    alert("โปรดไปที่หน้า 'จัดการข้อมูล' และตั้งรหัสผ่านสำหรับไฟล์สำรองให้ตรงกับไฟล์ที่ต้องการนำเข้า แล้วลองอีกครั้ง");
                                    return;
                                }

                                this.showToast('กำลังถอดรหัสด้วยรหัสผ่านที่บันทึกไว้...', 'warning');
                                const decryptedString = await this.decryptData(importedData, adminPassword);

                                if (decryptedString) {
                                    finalDataToMerge = JSON.parse(decryptedString);
                                    this.showToast('ถอดรหัสสำเร็จ!', 'success');
                                } else {
                                    this.showToast("ถอดรหัสล้มเหลว! รหัสผ่านในระบบอาจไม่ตรงกับไฟล์", "error");
                                    alert("รหัสผ่านที่ตั้งไว้ในระบบไม่สามารถใช้ถอดรหัสไฟล์นี้ได้ โปรดตรวจสอบรหัสผ่านในหน้า 'จัดการข้อมูล' แล้วลองอีกครั้ง");
                                    return;
                                }
                            } else {
                                // File is not encrypted, use it directly
                                finalDataToMerge = importedData;
                            }

                            if (finalDataToMerge && typeof finalDataToMerge === 'object' && 'users' in finalDataToMerge) {
                                const confirmationMessage = "คุณต้องการรวมข้อมูลจากไฟล์นี้เข้ากับข้อมูลปัจจุบันหรือไม่?\n\n- ข้อมูลที่ซ้ำกันจะถูกทับด้วยข้อมูลจากไฟล์\n- ข้อมูลใหม่จะถูกเพิ่มเข้ามา\n- **สต็อกสินค้าจะถูกคำนวณใหม่ทั้งหมด**\n\nยืนยันเพื่อดำเนินการต่อ?";
                                
                                if (confirm(confirmationMessage)) {
                                    this.mergeData(finalDataToMerge);
                                    this.recalculateAllStock();
                                    this.saveData();
                                    this.showToast('รวมข้อมูลและคำนวณสต็อกใหม่สำเร็จ! กำลังรีโหลด...', 'success');
                                    setTimeout(() => location.reload(), 2000);
                                }
                            } else {
                                throw new Error("ไฟล์ไม่มีโครงสร้างข้อมูลที่ถูกต้อง");
                            }
                        } catch (error) {
                            this.showToast("เกิดข้อผิดพลาด: " + error.message, "error");
                        } finally {
                            event.target.value = '';
                        }
                    };
                    reader.onerror = () => this.showToast("ไม่สามารถอ่านไฟล์ได้", "error");
                    reader.readAsText(file, 'UTF-8');
                },
                handleSelectiveReset() {
                    const resetSales = document.getElementById('reset-sales-checkbox').checked;
                    const resetStockIns = document.getElementById('reset-stockins-checkbox').checked;
                    const resetProducts = document.getElementById('reset-products-checkbox').checked;
                    const resetSellers = document.getElementById('reset-sellers-checkbox').checked;
                    const resetStores = document.getElementById('reset-stores-checkbox').checked;

                    if (!resetSales && !resetStockIns && !resetProducts && !resetSellers && !resetStores) {
                        this.showToast('กรุณาเลือกอย่างน้อยหนึ่งรายการที่จะรีเซ็ต', 'warning');
                        return;
                    }
                    let confirmationMessage = "คุณกำลังจะลบข้อมูลต่อไปนี้อย่างถาวร:\n";
                    if(resetSales) confirmationMessage += "\n- ประวัติการขายทั้งหมด";
                    if(resetStockIns) confirmationMessage += "\n- ประวัติการนำเข้าและปรับออกทั้งหมด";
                    if(resetProducts) confirmationMessage += "\n- สินค้าทั้งหมด";
                    if(resetSellers) confirmationMessage += "\n- ผู้ขายทั้งหมด (ยกเว้น Admin)";
                    if(resetStores) confirmationMessage += "\n- ร้านค้าทั้งหมด";
                    confirmationMessage += "\n\nการกระทำนี้ไม่สามารถย้อนกลับได้! พิมพ์ '5555' เพื่อยืนยัน:";
                    const userConfirmation = prompt(confirmationMessage);

                    if (userConfirmation === '5555') {
                        if (resetSales) { this.data.sales = []; }
                        if (resetStockIns) { this.data.stockIns = []; this.data.stockOuts = []; }
                        if (resetProducts) { this.data.products = []; }
                        if (resetSellers) { this.data.users = this.data.users.filter(u => u.role !== 'seller'); }
                        if (resetStores) { this.data.stores = []; }
                        
                        this.saveData();
                        this.closeResetModal();
                        this.showToast('ข้อมูลที่เลือกถูกรีเซ็ตเรียบร้อยแล้ว! กำลังรีโหลด...', 'success');
                        setTimeout(() => { location.reload(); }, 2000);
                    } else {
                        this.showToast('การรีเซ็ตถูกยกเลิก', 'warning');
                    }
                },
                manualSaveToBrowser() { try { this.saveData(); this.showToast('✓ บันทึกข้อมูลลงในเบราว์เซอร์แล้ว'); } catch (error) { console.error("บันทึกข้อมูลไม่สำเร็จ:", error); this.showToast("⚠️ เกิดข้อผิดพลาดในการบันทึกข้อมูล", "error"); } },


                // --- SUMMARY & REPORTING ENGINE ---
                handleSummaryOutput(choice) {
                    if (!this.summaryContext || !this.summaryContext.type) {
                        this.closeSummaryOutputModal();
                        return;
                    }

                    let htmlGenerator;
                    let excelExporter;

                    switch (this.summaryContext.type) {
                        case 'detailed_list':
                            htmlGenerator = () => this.buildDetailedListHtml(this.summaryContext);
                            excelExporter = () => this.exportDetailedListToXlsx(this.summaryContext);
                            break;
                        case 'credit':
                            htmlGenerator = () => this.buildCreditSummaryHtml(this.summaryContext);
                            excelExporter = () => this.exportCreditSummaryToXlsx(this.summaryContext);
                            break;
                        case 'transfer':
                            htmlGenerator = () => this.buildTransferSummaryHtml(this.summaryContext);
                            excelExporter = () => this.exportTransferSummaryToXlsx(this.summaryContext);
                            break;
                        default: // 'aggregated_pos'
                            htmlGenerator = () => this.buildPosSummaryHtml(this.summaryContext);
                            excelExporter = () => this.exportPosSummaryToXlsx(this.summaryContext);
                            break;
                    }

                    if (choice === 'display') {
                        const html = htmlGenerator();
                        this.openSummaryModal(html);
                    } else if (choice === 'excel') {
                        excelExporter();
                    } else if (choice === 'pdf') {
                        const html = htmlGenerator();
                        const printContainer = document.getElementById('print-container');
                        if (printContainer) {
                            printContainer.innerHTML = html;
                            window.print();
                        }
                    }

                    this.closeSummaryOutputModal();
                },
                _runSummary(startDate, endDate, title, periodName, sellerId = null, extraContext = {}) {
                    const summaryResult = this.generatePosSummaryData(startDate, endDate, sellerId);
                    if (summaryResult.salesCount === 0) {
                        this.showToast("ไม่พบข้อมูลการขายในช่วงที่กำหนด");
                        return;
                    }

                    // Calculate stock as of the end of the report date
                    const stockAsOfData = this.calculateStockAsOf(endDate);
                    const stockAsOfDateMap = new Map();
                    stockAsOfData.forEach(item => {
                        stockAsOfDateMap.set(item.name, item.stock);
                    });

                    const isSingleDay = (startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth() && startDate.getDate() === endDate.getDate());
                    const thaiDateString = isSingleDay ? this.formatThaiDateShortYear(startDate) : `${this.formatThaiDateShortYear(startDate)} ถึง ${this.formatThaiDateShortYear(endDate)}`;
                    const dateString = `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`;

                    this.summaryContext = {
                        type: 'aggregated_pos',
                        summaryResult,
                        title,
                        dateString,
                        thaiDateString,
                        periodName,
                        sellerIdFilter: sellerId,
                        startDate,
                        endDate,
                        stockAsOfDate: stockAsOfDateMap // Pass the correctly calculated stock data
                    };
                    Object.assign(this.summaryContext, extraContext);
                    this.openSummaryOutputModal();
                },
                _getAdminReportFilters() {
                    const sellerId = document.getElementById('summary-seller-select').value;
                    const startDateStr = document.getElementById('summary-custom-start-date').value;
                    const endDateStr = document.getElementById('summary-custom-end-date').value;

                    if (!startDateStr || !endDateStr) {
                        this.showToast("กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด", "error");
                        return null;
                    }
                    const startDate = new Date(startDateStr);
                    startDate.setHours(0, 0, 0, 0);
                    const endDate = new Date(endDateStr);
                    endDate.setHours(23, 59, 59, 999);
                    if (startDate > endDate) {
                        this.showToast("วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด", "error");
                        return null;
                    }

                    const selectedUser = this.data.users.find(u => u.id == sellerId);
                    const sellerName = sellerId === 'all' ? 'ผู้ขายทั้งหมด' : (selectedUser ? selectedUser.username : 'ไม่พบผู้ขาย');

                    return { sellerId, startDate, endDate, startDateStr, endDateStr, sellerName };
                },
                _getAdminQuickSummaryFilters() {
                    const sellerId = document.getElementById('summary-seller-select').value;
                    const selectedUser = this.data.users.find(u => u.id == sellerId);
                    const sellerName = sellerId === 'all' ? 'ผู้ขายทั้งหมด' : (selectedUser ? selectedUser.username : 'ไม่พบผู้ขาย');
                    return { sellerId, sellerName };
                },
                filterSalesData(startDate, endDate, sellerId, paymentTypes) {
                    return this.data.sales.filter(sale => {
                        const saleDate = new Date(sale.date);
                        if (saleDate < startDate || saleDate > endDate) return false;
                        if (sellerId !== 'all' && sale.sellerId != sellerId) return false;
                        const paymentMethod = sale.paymentMethod || 'เงินสด';
                        if (!paymentTypes.includes(paymentMethod)) return false;
                        return true;
                    }).sort((a, b) => new Date(b.date) - new Date(a.date));
                },
                runAdminDetailedReport() {
                    const filters = this._getAdminReportFilters();
                    if (!filters) return;
                    const { sellerId, startDate, endDate, startDateStr, endDateStr, sellerName } = filters;

                    const selectedPaymentTypes = Array.from(document.querySelectorAll('#summary-payment-types input:checked')).map(cb => cb.value);
                    if (selectedPaymentTypes.length === 0) {
                        this.showToast("กรุณาเลือกข้อมูลที่จะสรุปอย่างน้อย 1 ประเภท", "error");
                        return;
                    }

                    const filteredSales = this.filterSalesData(startDate, endDate, sellerId, selectedPaymentTypes);

                    if (filteredSales.length === 0) {
                        this.showToast("ไม่พบข้อมูลการขายตามเงื่อนไขที่กำหนด");
                        return;
                    }

                    const thaiDateString = `${this.formatThaiDateFullYear(startDate)} ถึง ${this.formatThaiDateFullYear(endDate)}`;
                    const title = `รายงานการขายของ ${sellerName}`;
                    const periodName = `Detailed_Report_${sellerId}_${startDateStr}_to_${endDateStr}`;

                    this.summaryContext = {
                        type: 'detailed_list',
                        filteredSales,
                        title,
                        thaiDateString,
                        periodName,
                        sellerId: sellerId
                    };
                    this.openSummaryOutputModal();
                },
                runAdminCreditSummary() {
                    const filters = this._getAdminReportFilters();
                    if (!filters) return;
                    const { sellerId, startDate, endDate, startDateStr, endDateStr, sellerName } = filters;

                    const filteredCreditSales = this.data.sales.filter(s => {
                        if (s.paymentMethod !== 'เครดิต') return false;
                        const saleDate = new Date(s.date);
                        if (saleDate < startDate || saleDate > endDate) return false;
                        if (sellerId !== 'all' && s.sellerId != sellerId) return false;
                        return true;
                    });

                    if (filteredCreditSales.length === 0) {
                        this.showToast("ไม่พบข้อมูลลูกหนี้ (เครดิต) ในช่วงเวลาที่เลือก", "warning");
                        return;
                    }

                    const summaryTimestamp = this.formatThaiTimestamp(new Date());

                    this.summaryContext = {
                        type: 'credit',
                        creditData: {
                            filteredCreditSales: filteredCreditSales.sort((a, b) => new Date(b.date) - new Date(a.date)),
                            sellerName: sellerName,
                            startDate,
                            endDate,
                            summaryTimestamp
                        },
                        title: `สรุปรายการลูกหนี้ของ ${sellerName}`,
                        periodName: `Credit_Admin_${sellerId}_${startDateStr}_to_${endDateStr}`
                    };
                    this.openSummaryOutputModal();
                },
                runAdminTransferSummary() {
                    const filters = this._getAdminReportFilters();
                    if (!filters) return;
                    const { sellerId, startDate, endDate, startDateStr, endDateStr, sellerName } = filters;

                    const filteredTransferSales = this.data.sales.filter(s => {
                        if (s.paymentMethod !== 'เงินโอน') return false;
                        const saleDate = new Date(s.date);
                        if (saleDate < startDate || saleDate > endDate) return false;
                        if (sellerId !== 'all' && s.sellerId != sellerId) return false;
                        return true;
                    });

                    if (filteredTransferSales.length === 0) {
                        this.showToast("ไม่พบข้อมูลเงินโอนในช่วงเวลาที่เลือก", "warning");
                        return;
                    }

                    const summaryTimestamp = this.formatThaiTimestamp(new Date());

                    this.summaryContext = {
                        type: 'transfer',
                        transferData: {
                            filteredTransferSales: filteredTransferSales.sort((a, b) => new Date(b.date) - new Date(a.date)),
                            sellerName: sellerName,
                            startDate,
                            endDate,
                            summaryTimestamp
                        },
                        title: `สรุปรายการเงินโอนของ ${sellerName}`,
                        periodName: `Transfer_Admin_${sellerId}_${startDateStr}_to_${endDateStr}`
                    };
                    this.openSummaryOutputModal();
                },
                runAdminSummaryByCustomRange() {
                    const filters = this._getAdminReportFilters();
                    if (!filters) return;
                    const { sellerId, startDate, endDate, startDateStr, endDateStr, sellerName } = filters;
                    const title = `สรุปภาพรวม: ${sellerName}`;
                    const periodName = `Aggregated_${sellerId}_${startDateStr}_to_${endDateStr}`;

                    this._runSummary(startDate, endDate, title, periodName, sellerId);
                },
                runAdminSummaryToday() {
                    const filters = this._getAdminQuickSummaryFilters();
                    if (!filters) return;
                    const { sellerId, sellerName } = filters;
                    const todayStart = new Date();
                    todayStart.setHours(0, 0, 0, 0);
                    const todayEnd = new Date();
                    todayEnd.setHours(23, 59, 59, 999);
                    const title = `สรุปยอดขายวันนี้ (${sellerName})`;
                    const periodName = `Admin_Today_${sellerId}`;
                    this._runSummary(todayStart, todayEnd, title, periodName, sellerId);
                },
                runAdminSummaryByDay() {
                    const filters = this._getAdminQuickSummaryFilters();
                    if (!filters) return;
                    const { sellerId, sellerName } = filters;
                    const dateStr = document.getElementById('admin-summary-date').value;
                    if (!dateStr) {
                        this.showToast("กรุณาเลือกวันที่", "warning");
                        return;
                    }
                    const startDate = new Date(dateStr);
                    startDate.setHours(0, 0, 0, 0);
                    const endDate = new Date(dateStr);
                    endDate.setHours(23, 59, 59, 999);
                    const title = `สรุปยอดขายวันที่ ${this.formatThaiDateFullYear(startDate)} (${sellerName})`;
                    const periodName = `Admin_Day_${dateStr}_${sellerId}`;
                    this._runSummary(startDate, endDate, title, periodName, sellerId);
                },
                runAdminSummaryAll() {
                    const filters = this._getAdminQuickSummaryFilters();
                    if (!filters) return;
                    const { sellerId, sellerName } = filters;

                    let relevantSales = this.data.sales;
                    if (sellerId !== 'all') {
                        relevantSales = this.data.sales.filter(s => s.sellerId == sellerId);
                    }
                    if (relevantSales.length === 0) {
                        this.showToast(`ไม่พบข้อมูลการขายสำหรับ ${sellerName}`);
                        return;
                    }

                    const allDates = relevantSales.map(s => new Date(s.date));
                    const startDate = new Date(Math.min.apply(null, allDates));
                    startDate.setHours(0, 0, 0, 0);
                    const endDate = new Date(Math.max.apply(null, allDates));
                    endDate.setHours(23, 59, 59, 999);
                    const timeDiff = endDate.getTime() - startDate.getTime();
                    const dayCount = Math.round(timeDiff / (1000 * 3600 * 24));
                    const title = `สรุปยอดขายทั้งหมด (${sellerName})`;
                    const periodName = `Admin_All_${sellerId}`;
                    this._runSummary(startDate, endDate, title, periodName, sellerId, { dayCount });
                },
                runSellerDetailedReport() {
                    const startDateStr = document.getElementById('seller-report-start-date').value;
                    const endDateStr = document.getElementById('seller-report-end-date').value;
                    const selectedPaymentTypes = Array.from(document.querySelectorAll('#seller-report-payment-types input:checked')).map(cb => cb.value);

                    if (!startDateStr || !endDateStr) {
                        this.showToast("กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด", "error");
                        return;
                    }
                    const startDate = new Date(startDateStr);
                    startDate.setHours(0, 0, 0, 0);
                    const endDate = new Date(endDateStr);
                    endDate.setHours(23, 59, 59, 999);
                    if (startDate > endDate) {
                        this.showToast("วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด", "error");
                        return;
                    }
                    if (selectedPaymentTypes.length === 0) {
                        this.showToast("กรุณาเลือกประเภทการชำระเงินอย่างน้อย 1 อย่าง", "error");
                        return;
                    }

                    const filteredSales = this.filterSalesData(startDate, endDate, this.currentUser.id, selectedPaymentTypes);

                    if (filteredSales.length === 0) {
                        this.showToast("ไม่พบข้อมูลการขายตามเงื่อนไขที่กำหนด");
                        return;
                    }

                    const thaiDateString = `${this.formatThaiDateFullYear(startDate)} ถึง ${this.formatThaiDateFullYear(endDate)}`;
                    const title = `รายงานการขายของ ${this.currentUser.username}`;
                    const periodName = `Seller_Detailed_Report_${this.currentUser.username}_${startDateStr}_to_${endDateStr}`;

                    this.summaryContext = {
                        type: 'detailed_list',
                        filteredSales,
                        title,
                        thaiDateString,
                        periodName,
                        sellerId: this.currentUser.id
                    };

                    this.openSummaryOutputModal();
                },
                runSellerCreditSummary() {
                    const startDateStr = document.getElementById('seller-credit-start-date').value;
                    const endDateStr = document.getElementById('seller-credit-end-date').value;

                    if (!startDateStr || !endDateStr) {
                        this.showToast("กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด", "error");
                        return;
                    }
                    const startDate = new Date(startDateStr);
                    startDate.setHours(0, 0, 0, 0);
                    const endDate = new Date(endDateStr);
                    endDate.setHours(23, 59, 59, 999);
                    if (startDate > endDate) {
                        this.showToast("วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด", "error");
                        return;
                    }

                    const filteredCreditSales = this.data.sales.filter(s => {
                        if (s.sellerId !== this.currentUser.id || s.paymentMethod !== 'เครดิต') return false;
                        const saleDate = new Date(s.date);
                        return saleDate >= startDate && saleDate <= endDate;
                    });

                    if (filteredCreditSales.length === 0) {
                        this.showToast("ไม่พบข้อมูลลูกหนี้ (เครดิต) ในช่วงเวลาที่เลือก", "warning");
                        return;
                    }

                    const summaryTimestamp = this.formatThaiTimestamp(new Date());

                    this.summaryContext = {
                        type: 'credit',
                        creditData: {
                            filteredCreditSales: filteredCreditSales.sort((a, b) => new Date(b.date) - new Date(a.date)),
                            sellerName: this.currentUser.username,
                            startDate,
                            endDate,
                            summaryTimestamp
                        },
                        title: `สรุปรายการลูกหนี้ของ ${this.currentUser.username}`,
                        periodName: `Credit_Seller_${this.currentUser.id}_${startDateStr}_to_${endDateStr}`
                    };
                    this.openSummaryOutputModal();
                },
                runSellerTransferSummary() {
                    const startDateStr = document.getElementById('seller-transfer-start-date').value;
                    const endDateStr = document.getElementById('seller-transfer-end-date').value;

                    if (!startDateStr || !endDateStr) {
                        this.showToast("กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด", "error");
                        return;
                    }
                    const startDate = new Date(startDateStr);
                    startDate.setHours(0, 0, 0, 0);
                    const endDate = new Date(endDateStr);
                    endDate.setHours(23, 59, 59, 999);
                    if (startDate > endDate) {
                        this.showToast("วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด", "error");
                        return;
                    }

                    const filteredTransferSales = this.data.sales.filter(s => {
                        if (s.sellerId !== this.currentUser.id || s.paymentMethod !== 'เงินโอน') return false;
                        const saleDate = new Date(s.date);
                        return saleDate >= startDate && saleDate <= endDate;
                    });

                    if (filteredTransferSales.length === 0) {
                        this.showToast("ไม่พบข้อมูลเงินโอนในช่วงเวลาที่เลือก", "warning");
                        return;
                    }

                    const summaryTimestamp = this.formatThaiTimestamp(new Date());

                    this.summaryContext = {
                        type: 'transfer',
                        transferData: {
                            filteredTransferSales: filteredTransferSales.sort((a, b) => new Date(b.date) - new Date(a.date)),
                            sellerName: this.currentUser.username,
                            startDate,
                            endDate,
                            summaryTimestamp
                        },
                        title: `สรุปรายการเงินโอนของ ${this.currentUser.username}`,
                        periodName: `Transfer_Seller_${this.currentUser.id}_${startDateStr}_to_${endDateStr}`
                    };
                    this.openSummaryOutputModal();
                },
                summarizeMyToday() {
                    const todayStart = new Date();
                    todayStart.setHours(0, 0, 0, 0);
                    const todayEnd = new Date();
                    todayEnd.setHours(23, 59, 59, 999);
                    this._runSummary(todayStart, todayEnd, `สรุปยอดขายวันนี้ (${this.currentUser.username})`, `MyToday`, this.currentUser.id);
                },
                summarizeMyDay() {
                    const dateStr = document.getElementById('my-summary-date').value;
                    if (!dateStr) {
                        this.showToast("กรุณาเลือกวันที่", 'warning');
                        return;
                    }
                    const startDate = new Date(dateStr);
                    startDate.setHours(0, 0, 0, 0);
                    const endDate = new Date(dateStr);
                    endDate.setHours(23, 59, 59, 999);
                    this._runSummary(startDate, endDate, `สรุปยอดขายวันที่เลือก (${this.currentUser.username})`, `MyDate_${dateStr}`, this.currentUser.id);
                },
                summarizeMyRange() {
                    const startDateStr = document.getElementById('my-summary-start-date').value;
                    const endDateStr = document.getElementById('my-summary-end-date').value;
                    if (!startDateStr || !endDateStr) {
                        this.showToast("กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด", "error");
                        return;
                    }
                    const startDate = new Date(startDateStr);
                    startDate.setHours(0, 0, 0, 0);
                    const endDate = new Date(endDateStr);
                    endDate.setHours(23, 59, 59, 999);
                    if (startDate > endDate) {
                        this.showToast("วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด", "error");
                        return;
                    }
                    const timeDiff = endDate.getTime() - startDate.getTime();
                    const dayCount = Math.round(timeDiff / (1000 * 3600 * 24));
                    const title = `สรุปยอดขายตามช่วงวันที่ (${this.currentUser.username})`;
                    const periodName = `MyRange_${startDateStr}_to_${endDateStr}`;
                    this._runSummary(startDate, endDate, title, periodName, this.currentUser.id, { dayCount });
                },
                summarizeMyAll() {
                    const mySales = this.data.sales.filter(s => s.sellerId === this.currentUser.id);
                    if (mySales.length === 0) {
                        this.showToast("คุณยังไม่มีข้อมูลการขาย");
                        return;
                    }
                    const allMyDates = mySales.map(s => new Date(s.date));
                    const startDate = new Date(Math.min.apply(null, allMyDates));
                    startDate.setHours(0, 0, 0, 0);
                    const endDate = new Date(Math.max.apply(null, allMyDates));
                    endDate.setHours(23, 59, 59, 999);
                    const timeDiff = endDate.getTime() - startDate.getTime();
                    const dayCount = Math.round(timeDiff / (1000 * 3600 * 24));
                    this._runSummary(startDate, endDate, `สรุปยอดขายทั้งหมด (${this.currentUser.username})`, `MyAll`, this.currentUser.id, { dayCount });
                },
                generatePosSummaryData(startDate, endDate, sellerIdFilter = null, paymentTypesFilter = ['เงินสด', 'เงินโอน', 'เครดิต']) {
                    const summary = { grandTotalSales: 0, grandTotalProfit: 0, grandTotalCash: 0, grandTotalCredit: 0, grandTotalTransfer: 0, salesCount: 0, sellerSummary: {}, totalSellingDays: 0 };

                    let salesToProcess = this.data.sales;
                    if (sellerIdFilter && sellerIdFilter !== 'all') {
                        salesToProcess = salesToProcess.filter(s => s.sellerId == sellerIdFilter);
                    }

                    const filteredSales = salesToProcess.filter(sale => {
                        const saleDate = new Date(sale.date);
                        if (saleDate < startDate || saleDate > endDate) {
                            return false;
                        }

                        const paymentMethod = sale.paymentMethod || 'เงินสด';
                        if (!paymentTypesFilter.includes(paymentMethod)) return false;

                        const seller = this.data.users.find(u => u.id === sale.sellerId);
                        if (seller && seller.role === 'seller') {
                            if (seller.salesStartDate) {
                                const sellerStartDate = new Date(seller.salesStartDate);
                                sellerStartDate.setHours(0, 0, 0, 0);
                                if (saleDate < sellerStartDate) {
                                    return false;
                                }
                            }
                            if (seller.salesEndDate) {
                                const sellerEndDate = new Date(seller.salesEndDate);
                                sellerEndDate.setHours(23, 59, 59, 999);
                                if (saleDate > sellerEndDate) {
                                    return false;
                                }
                            }
                        }
                        return true;
                    });

                    summary.salesCount = filteredSales.length;
                    filteredSales.forEach(sale => {
                        const sellerId = sale.sellerId || 'unknown';
                        if (!summary.sellerSummary[sellerId]) {
                            summary.sellerSummary[sellerId] = { sellerName: sale.sellerName || 'ไม่ระบุ', totalSales: 0, totalProfit: 0, totalCash: 0, totalCredit: 0, totalTransfer: 0, productSummary: {} };
                        }
                        const sellerData = summary.sellerSummary[sellerId];
                        sellerData.totalSales += sale.total;
                        sellerData.totalProfit += sale.profit;
                        summary.grandTotalSales += sale.total;
                        summary.grandTotalProfit += sale.profit;

                        const paymentType = sale.paymentMethod || 'เงินสด';
                        if (paymentType === 'เครดิต') {
                            summary.grandTotalCredit += sale.total;
                            sellerData.totalCredit += sale.total;
                        } else if (paymentType === 'เงินโอน') {
                            summary.grandTotalTransfer += sale.total;
                            sellerData.totalTransfer += sale.total;
                        } else {
                            summary.grandTotalCash += sale.total;
                            sellerData.totalCash += sale.total;
                        }

                        sale.items.forEach(item => {
                            const productId = item.productId;
                            if (!sellerData.productSummary[productId]) {
                                const productInfo = this.data.products.find(p => p.id === productId);
                                sellerData.productSummary[productId] = {
                                    name: item.name,
                                    // This stock value is the LIVE stock, it will be replaced by the calculated one in the display function.
                                    stock: productInfo ? productInfo.stock : 'N/A',
                                    unit: productInfo ? productInfo.unit : 'หน่วย',
                                    cashQty: 0,
                                    creditQty: 0,
                                    transferQty: 0,
                                    totalQty: 0,
                                    totalValue: 0,
                                };
                            }
                            const productSum = sellerData.productSummary[productId];
                            productSum.totalQty += item.quantity;
                            productSum.totalValue += (item.price * item.quantity);
                            if (paymentType === 'เครดิต') {
                                productSum.creditQty += item.quantity;
                            } else if (paymentType === 'เงินโอน') {
                                productSum.transferQty += item.quantity;
                            } else {
                                productSum.cashQty += item.quantity;
                            }
                        });
                    });

                    const uniqueSaleDays = new Set();
                    filteredSales.forEach(sale => {
                        const datePart = sale.date.split('T')[0];
                        uniqueSaleDays.add(datePart);
                    });
                    summary.totalSellingDays = uniqueSaleDays.size;

                    return summary;
                },
                buildDetailedListHtml(context) {
                    const { filteredSales, title, thaiDateString, sellerId } = context;
                    const user = this.data.users.find(u => u.id == sellerId);
                    const isSellerReport = user && user.role === 'seller';
                    const isAdminReport = this.currentUser.role === 'admin';

                    let tableRows = '';
                    let totalSales = 0;
                    let totalProfit = 0;

                    filteredSales.forEach(sale => {
                        const saleDate = new Date(sale.date);
                        const dateString = this.formatThaiDateShortYear(sale.date);
                        const timeString = `${String(saleDate.getHours()).padStart(2, '0')}.${String(saleDate.getMinutes()).padStart(2, '0')} น.`;
                        const itemsList = sale.items.map(item => {
                            let itemText = `${item.name} (x${this.formatNumberSmart(item.quantity)})`;
                            if (item.isSpecialPrice) {
                                itemText += ` <span style="color:red; font-weight:normal;">(พิเศษ ฿${this.formatNumberSmart(item.price)})</span>`;
                            }
                            return itemText;
                        }).join('<br>');

                        let paymentDisplay = sale.paymentMethod || 'เงินสด';
                        if (sale.paymentMethod === 'เครดิต' && sale.buyerName) {
                            paymentDisplay = `${paymentDisplay} (${sale.buyerName})`;
                        } else if (sale.paymentMethod === 'เงินโอน' && sale.transferorName) {
                            paymentDisplay = `${paymentDisplay} (${sale.transferorName})`;
                        }

                        tableRows += `<tr>
                            <td data-label="วันที่">${dateString}</td>
                            <td data-label="เวลา">${timeString}</td>
                            <td data-label="รายการ">${itemsList}</td>
                            <td data-label="ยอดขาย">${this.formatNumberSmart(sale.total)}</td>
                            ${isAdminReport ? `<td data-label="กำไร" style="color:${sale.profit >= 0 ? 'green' : 'red'};">${this.formatNumberSmart(sale.profit)}</td>` : ''}
                            <td data-label="ประเภทชำระ">${paymentDisplay}</td>
                        </tr>`;

                        totalSales += sale.total;
                        if (isAdminReport) {
                            totalProfit += sale.profit;
                        }
                    });

                    let footerRows = `<tr style="font-weight: bold; background-color: #f0f0f0;">
                        <td colspan="3" style="text-align: right;">ยอดรวมทั้งหมด:</td>
                        <td>${this.formatNumberSmart(totalSales)}</td>
                        ${isAdminReport ? `<td style="color:${totalProfit >= 0 ? 'green' : 'red'};">${this.formatNumberSmart(totalProfit)}</td>` : ''}
                        <td></td>
                    </tr>`;

                    if (isSellerReport && user.commissionRate > 0) {
                        let totalCommission = 0;
                        let commissionDetails = [];

                        const salesByCash = filteredSales.filter(s => (s.paymentMethod || 'เงินสด') === 'เงินสด').reduce((sum, s) => sum + s.total, 0);
                        const salesByTransfer = filteredSales.filter(s => s.paymentMethod === 'เงินโอน').reduce((sum, s) => sum + s.total, 0);
                        const salesByCredit = filteredSales.filter(s => s.paymentMethod === 'เครดิต').reduce((sum, s) => sum + s.total, 0);

                        if (user.commissionOnCash && salesByCash > 0) {
                            const commission = salesByCash * (user.commissionRate / 100);
                            commissionDetails.push({ label: `ยอดขายเงินสด`, amount: salesByCash, commission: commission });
                            totalCommission += commission;
                        }
                        if (user.commissionOnTransfer && salesByTransfer > 0) {
                            const commission = salesByTransfer * (user.commissionRate / 100);
                            commissionDetails.push({ label: `ยอดขายเงินโอน`, amount: salesByTransfer, commission: commission });
                            totalCommission += commission;
                        }
                        if (user.commissionOnCredit && salesByCredit > 0) {
                            const commission = salesByCredit * (user.commissionRate / 100);
                            commissionDetails.push({ label: `ยอดขายเครดิต`, amount: salesByCredit, commission: commission });
                            totalCommission += commission;
                        }

                        if (commissionDetails.length > 0) {
                            const colspan = isAdminReport ? 6 : 5;
                            footerRows += `<tr style="font-weight: bold; background-color: #e0f7fa;"><td colspan="${colspan}" style="text-align:center;">คำนวณค่าคอมมิชชั่น (${user.commissionRate}%)</td></tr>`;
                            commissionDetails.forEach(detail => {
                                footerRows += `<tr style="background-color: #e0f7fa;">
                                    <td colspan="3" style="text-align: right;">${detail.label}: ${this.formatNumberSmart(detail.amount)} บาท</td>
                                    <td colspan="${colspan - 3}" style="text-align: left; padding-left: 20px; font-weight:bold;">ค่าคอมฯ: ${this.formatNumberSmart(detail.commission)} บาท</td>
                                 </tr>`;
                            });
                            footerRows += `<tr style="font-weight: bold; background-color: #cce7ee;">
                                <td colspan="3" style="text-align: right;">รวมค่าคอมมิชชั่นทั้งหมด:</td>
                                <td colspan="${colspan - 3}" style="text-align: left; padding-left: 20px; font-size: 1.1em;">${this.formatNumberSmart(totalCommission)} บาท</td>
                            </tr>`;
                        }
                    }

                    const tableClass = isAdminReport ? 'detailed-sales-table admin-view' : 'detailed-sales-table';

                    return `
                        <div style="text-align:center;">
                            <h2>${title}</h2>
                            <p style="font-size:0.9em; color:#333; font-weight:bold;">ช่วงวันที่ : ${thaiDateString}</p>
                            <div class="table-container">
                                <table class="${tableClass}">
                                    <thead>
                                        <tr>
                                            <th>วันที่</th>
                                            <th>เวลา</th>
                                            <th>รายการสินค้า</th>
                                            <th>ยอดขาย (บาท)</th>
                                            ${isAdminReport ? '<th>กำไร (บาท)</th>' : ''}
                                            <th>ประเภทชำระ</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${tableRows}
                                    </tbody>
                                    <tfoot>
                                        ${footerRows}
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    `;
                },
                exportDetailedListToXlsx(context) {
                    const { filteredSales, title, periodName, thaiDateString, sellerId } = context;
                    const user = this.data.users.find(u => u.id == sellerId);
                    const isSellerReport = user && user.role === 'seller';
                    const isAdminReport = this.currentUser.role === 'admin';

                    let dataRows = [];

                    const summaryTimestamp = this.formatThaiTimestamp(new Date());

                    dataRows.push([title]);
                    dataRows.push(['ช่วงวันที่:', thaiDateString]);
                    dataRows.push(['สรุปเมื่อ:', summaryTimestamp]);
                    dataRows.push([]);

                    let headers = ['วันที่', 'เวลา', 'รายการสินค้า (ชื่อ)', 'ราคาต่อหน่วย', 'จำนวน', 'ราคารวมต่อรายการ', 'ยอดขายรวม (บาท)'];
                    if (isAdminReport) {
                        headers.push('กำไรรวม (บาท)');
                    }
                    headers.push('ประเภทชำระ', 'รายละเอียดชำระ', 'กำหนดชำระ', 'ผู้ขาย', 'ร้านค้า');
                    dataRows.push(headers);

                    let grandTotalSales = 0;
                    let grandTotalProfit = 0;

                    filteredSales.forEach(sale => {
                        const saleDate = new Date(sale.date);
                        const dateString = this.formatThaiDateFullYear(sale.date);
                        const timeString = `${String(saleDate.getHours()).padStart(2, '0')}:${String(saleDate.getMinutes()).padStart(2, '0')}`;

                        let paymentDetail = '-';
                        if (sale.paymentMethod === 'เครดิต') {
                            paymentDetail = sale.buyerName || '-';
                        } else if (sale.paymentMethod === 'เงินโอน') {
                            paymentDetail = sale.transferorName || '-';
                        }
                        const dueDateString = this.formatThaiDateFullYear(sale.creditDueDate);

                        grandTotalSales += sale.total;
                        if (isAdminReport) {
                            grandTotalProfit += sale.profit;
                        }

                        sale.items.forEach((item, index) => {
                            const itemTotal = item.price * item.quantity;
                            let row = [
                                index === 0 ? dateString : '',
                                index === 0 ? timeString : '',
                                item.name + (item.isSpecialPrice ? ' (พิเศษ)' : ''),
                                this.formatNumberSmart(item.price),
                                this.formatNumberSmart(item.quantity),
                                this.formatNumberSmart(itemTotal),
                                index === 0 ? this.formatNumberSmart(sale.total) : ''
                            ];

                            if (isAdminReport) {
                                row.push(index === 0 ? this.formatNumberSmart(sale.profit) : '');
                            }

                            row.push(
                                index === 0 ? (sale.paymentMethod || 'เงินสด') : '',
                                index === 0 ? paymentDetail : '',
                                index === 0 ? dueDateString : '',
                                index === 0 ? (sale.sellerName || '-') : '',
                                index === 0 ? (sale.storeName || '-') : ''
                            );
                            dataRows.push(row);
                        });
                    });

                    dataRows.push([]);
                    let footerRow = ['', '', '', '', '', 'ยอดรวมทั้งหมด', this.formatNumberSmart(grandTotalSales)];
                    if (isAdminReport) {
                        footerRow.push(this.formatNumberSmart(grandTotalProfit));
                    }
                    dataRows.push(footerRow);

                    if (isSellerReport && user.commissionRate > 0) {
                        let totalCommission = 0;
                        let commissionDetails = [];

                        const salesByCash = filteredSales.filter(s => (s.paymentMethod || 'เงินสด') === 'เงินสด').reduce((sum, s) => sum + s.total, 0);
                        const salesByTransfer = filteredSales.filter(s => s.paymentMethod === 'เงินโอน').reduce((sum, s) => sum + s.total, 0);
                        const salesByCredit = filteredSales.filter(s => s.paymentMethod === 'เครดิต').reduce((sum, s) => sum + s.total, 0);

                        if (user.commissionOnCash && salesByCash > 0) {
                            const commission = salesByCash * (user.commissionRate / 100);
                            commissionDetails.push({ label: `ยอดขายเงินสด`, amount: salesByCash, commission: commission });
                            totalCommission += commission;
                        }
                        if (user.commissionOnTransfer && salesByTransfer > 0) {
                            const commission = salesByTransfer * (user.commissionRate / 100);
                            commissionDetails.push({ label: `ยอดขายเงินโอน`, amount: salesByTransfer, commission: commission });
                            totalCommission += commission;
                        }
                        if (user.commissionOnCredit && salesByCredit > 0) {
                            const commission = salesByCredit * (user.commissionRate / 100);
                            commissionDetails.push({ label: `ยอดขายเครดิต`, amount: salesByCredit, commission: commission });
                            totalCommission += commission;
                        }

                        if (commissionDetails.length > 0) {
                            dataRows.push([]);
                            dataRows.push([`คำนวณค่าคอมมิชชั่น (${user.commissionRate}%)`]);
                            commissionDetails.forEach(detail => {
                                dataRows.push(['', '', '', '', '', `${detail.label}: ${this.formatNumberSmart(detail.amount)} บาท`, `ค่าคอมฯ: ${this.formatNumberSmart(detail.commission)} บาท`]);
                            });
                            dataRows.push(['', '', '', '', '', 'รวมค่าคอมมิชชั่นทั้งหมด', this.formatNumberSmart(totalCommission)]);
                        }
                    }

                    // สร้างไฟล์ Excel
                    const ws = XLSX.utils.aoa_to_sheet(dataRows);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "รายงานการขาย");

                    // สร้าง blob และดาวน์โหลด
                    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'binary' });

                    function s2ab(s) {
                        const buf = new ArrayBuffer(s.length);
                        const view = new Uint8Array(buf);
                        for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xFF;
                        return buf;
                    }

                    const blob = new Blob([s2ab(wbout)], { type: "application/octet-stream" });

                    const fileName = `${periodName}_${new Date().getTime()}.xlsx`;
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = fileName;
                    link.click();
                    URL.revokeObjectURL(link.href);
                    this.showToast(`ส่งออกไฟล์ Excel '${fileName}' สำเร็จ`);
                },
                buildCreditSummaryHtml(context) {
                    const { creditData } = context;
                    const { filteredCreditSales, sellerName, startDate, endDate, summaryTimestamp } = creditData;

                    const formatCurrency = (num) => this.formatNumberSmart(num);
                    const formatDate = (dateStr) => this.formatThaiDateShortYear(dateStr);

                    let totalCredit = 0;
                    let creditRows = '';
                    filteredCreditSales.forEach(s => {
                        totalCredit += s.total;
                        const itemsList = s.items.map(item => {
                            const product = this.data.products.find(p => p.id === item.productId);
                            const unit = product ? product.unit : 'หน่วย';
                            return `${item.name}(${this.formatNumberSmart(item.quantity)} ${unit})`;
                        }).join(', ');

                        creditRows += `<tr>
                            <td data-label="วันที่">${formatDate(s.date)}</td>
                            <td data-label="ผู้ซื้อ">${s.buyerName || '-'}</td>
                            <td data-label="ผู้ขาย">${s.sellerName || '-'}</td>
                            <td data-label="รายการ">${itemsList}</td>
                            <td data-label="ยอดเงิน(บาท)">${formatCurrency(s.total)}</td>
                            <td data-label="กำหนดชำระ">${formatDate(s.creditDueDate)}</td>
                        </tr>`;
                    });

                    const periodLine = `<p style="font-size:0.9em; color: #333; font-weight: bold; margin-bottom: 8px;">ช่วงเวลา: ${this.formatThaiDateFullYear(startDate)} ถึง ${this.formatThaiDateFullYear(endDate)}</p>`;

                    return `
                        <div style="text-align:center;">
                            <h2>สรุปรายการลูกหนี้ของ: ${sellerName}</h2>
                            <p style="font-size:0.8em; color:#555; margin-bottom: 0;">สรุปเมื่อ: ${summaryTimestamp}</p>
                            ${periodLine}
                            <table class="credit-details-table" style="margin-top: 15px;">
                                <thead><tr><th>วันที่</th><th>ผู้ซื้อ</th><th>ผู้ขาย</th><th>รายการ</th><th>ยอดเงิน (บาท)</th><th>กำหนดชำระ</th></tr></thead>
                                <tbody>${creditRows}</tbody>
                            </table>
                            <p style="text-align:right; font-size:1.2em; font-weight:bold; margin-top:15px;">ยอดรวมลูกหนี้ทั้งหมด: ${formatCurrency(totalCredit)} บาท</p>
                        </div>
                    `;
                },
                exportCreditSummaryToXlsx(context) {
                    const { creditData, periodName } = context;
                    const { filteredCreditSales, sellerName, startDate, endDate, summaryTimestamp } = creditData;
                    let dataRows = [];

                    const formatCurrency = (num) => this.formatNumberSmart(num);
                    const formatDate = (dateStr) => this.formatThaiDateFullYear(dateStr);
                    const periodString = `${this.formatThaiDateFullYear(startDate)} ถึง ${this.formatThaiDateFullYear(endDate)}`;

                    dataRows.push(['สรุปโดย:', this.currentUser.username]);
                    dataRows.push(['สรุปเมื่อ:', summaryTimestamp]);
                    dataRows.push([`สรุปรายการลูกหนี้ของ ${sellerName}:`, periodString]);
                    dataRows.push([]);

                    dataRows.push(['วันที่', 'ผู้ซื้อ', 'ผู้ขาย', 'รายการสินค้า', 'ยอดเงิน (บาท)', 'กำหนดชำระ']);

                    let totalCredit = 0;
                    filteredCreditSales.forEach(s => {
                        totalCredit += s.total;
                        const itemsList = s.items.map(item => {
                            const product = this.data.products.find(p => p.id === item.productId);
                            const unit = product ? product.unit : 'หน่วย';
                            return `${item.name}(${this.formatNumberSmart(item.quantity)} ${unit})`;
                        }).join('; ');

                        dataRows.push([
                            formatDate(s.date),
                            s.buyerName || '-',
                            s.sellerName || '-',
                            itemsList,
                            formatCurrency(s.total),
                            formatDate(s.creditDueDate)
                        ]);
                    });

                    dataRows.push([]);
                    dataRows.push(['', '', '', '', 'ยอดรวมลูกหนี้ทั้งหมด (บาท)', formatCurrency(totalCredit)]);

                    // สร้างไฟล์ Excel
                    const ws = XLSX.utils.aoa_to_sheet(dataRows);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "รายงานลูกหนี้");

                    // สร้าง blob และดาวน์โหลด
                    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'binary' });

                    function s2ab(s) {
                        const buf = new ArrayBuffer(s.length);
                        const view = new Uint8Array(buf);
                        for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xFF;
                        return buf;
                    }

                    const blob = new Blob([s2ab(wbout)], { type: "application/octet-stream" });

                    const fileName = `Credit_Summary_${periodName}_${new Date().getTime()}.xlsx`;
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = fileName;
                    link.click();
                    URL.revokeObjectURL(link.href);
                    this.showToast(`ส่งออกไฟล์ Excel '${fileName}' สำเร็จ`);
                },
                buildTransferSummaryHtml(context) {
                    const { transferData } = context;
                    const { filteredTransferSales, sellerName, startDate, endDate, summaryTimestamp } = transferData;

                    const formatCurrency = (num) => this.formatNumberSmart(num);
                    const formatDate = (dateStr) => this.formatThaiDateShortYear(dateStr);

                    let totalTransfer = 0;
                    let transferRows = '';
                    filteredTransferSales.forEach(s => {
                        totalTransfer += s.total;
                        const itemsList = s.items.map(item => {
                            const product = this.data.products.find(p => p.id === item.productId);
                            const unit = product ? product.unit : 'หน่วย';
                            return `${item.name}(${this.formatNumberSmart(item.quantity)} ${unit})`;
                        }).join(', ');

                        transferRows += `<tr>
                            <td data-label="วันที่">${formatDate(s.date)}</td>
                            <td data-label="ผู้โอน">${s.transferorName || '-'}</td>
                            <td data-label="ผู้ขาย">${s.sellerName || '-'}</td>
                            <td data-label="รายการ">${itemsList}</td>
                            <td data-label="ยอดเงิน (บาท)">${formatCurrency(s.total)}</td>
                        </tr>`;
                    });

                    const periodLine = `<p style="font-size:0.9em; color: #333; font-weight: bold; margin-bottom: 8px;">ช่วงเวลา: ${this.formatThaiDateFullYear(startDate)} ถึง ${this.formatThaiDateFullYear(endDate)}</p>`;

                    return `
                        <div style="text-align:center;">
                            <h2>สรุปรายการเงินโอนของ: ${sellerName}</h2>
                            <p style="font-size:0.8em; color:#555; margin-bottom: 0;">สรุปเมื่อ: ${summaryTimestamp}</p>
                            ${periodLine}
                            <table class="transfer-details-table" style="margin-top: 15px;">
                                <thead><tr><th>วันที่</th><th>ผู้โอน</th><th>ผู้ขาย</th><th>รายการ</th><th>ยอดเงิน (บาท)</th></tr></thead>
                                <tbody>${transferRows}</tbody>
                            </table>
                            <p style="text-align:right; font-size:1.2em; font-weight:bold; margin-top:15px;">ยอดรวมเงินโอนทั้งหมด: ${formatCurrency(totalTransfer)} บาท</p>
                        </div>
                    `;
                },
                exportTransferSummaryToXlsx(context) {
                    const { transferData, periodName } = context;
                    const { filteredTransferSales, sellerName, startDate, endDate, summaryTimestamp } = transferData;
                    let dataRows = [];

                    const formatCurrency = (num) => this.formatNumberSmart(num);
                    const formatDate = (dateStr) => this.formatThaiDateFullYear(dateStr);
                    const periodString = `${this.formatThaiDateFullYear(startDate)} ถึง ${this.formatThaiDateFullYear(endDate)}`;

                    dataRows.push(['สรุปโดย:', this.currentUser.username]);
                    dataRows.push(['สรุปเมื่อ:', summaryTimestamp]);
                    dataRows.push([`สรุปรายการเงินโอนของ ${sellerName}:`, periodString]);
                    dataRows.push([]);

                    dataRows.push(['วันที่', 'ผู้โอน', 'ผู้ขาย', 'รายการสินค้า', 'ยอดเงิน (บาท)']);

                    let totalTransfer = 0;
                    filteredTransferSales.forEach(s => {
                        totalTransfer += s.total;
                        const itemsList = s.items.map(item => {
                            const product = this.data.products.find(p => p.id === item.productId);
                            const unit = product ? product.unit : 'หน่วย';
                            return `${item.name}(${this.formatNumberSmart(item.quantity)} ${unit})`;
                        }).join('; ');

                        dataRows.push([
                            formatDate(s.date),
                            s.transferorName || '-',
                            s.sellerName || '-',
                            itemsList,
                            formatCurrency(s.total)
                        ]);
                    });

                    dataRows.push([]);
                    dataRows.push(['', '', '', 'ยอดรวมเงินโอนทั้งหมด (บาท)', formatCurrency(totalTransfer)]);

                    // สร้างไฟล์ Excel
                    const ws = XLSX.utils.aoa_to_sheet(dataRows);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "รายงานเงินโอน");

                    // สร้าง blob และดาวน์โหลด
                    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'binary' });

                    function s2ab(s) {
                        const buf = new ArrayBuffer(s.length);
                        const view = new Uint8Array(buf);
                        for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xFF;
                        return buf;
                    }

                    const blob = new Blob([s2ab(wbout)], { type: "application/octet-stream" });

                    const fileName = `Transfer_Summary_${periodName}_${new Date().getTime()}.xlsx`;
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = fileName;
                    link.click();
                    URL.revokeObjectURL(link.href);
                    this.showToast(`ส่งออกไฟล์ Excel '${fileName}' สำเร็จ`);
                },
                exportSalesHistoryToXlsx() {
                    const startDateStr = document.getElementById('export-sales-start-date').value;
                    const endDateStr = document.getElementById('export-sales-end-date').value;

                    if (!startDateStr || !endDateStr) {
                        this.showToast('กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด', 'warning');
                        return;
                    }

                    const startDate = new Date(startDateStr);
                    startDate.setHours(0, 0, 0, 0);

                    const endDate = new Date(endDateStr);
                    endDate.setHours(23, 59, 59, 999);

                    if (startDate > endDate) {
                        this.showToast('วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด', 'error');
                        return;
                    }

                    const filteredSales = this.data.sales.filter(sale => {
                        const saleDate = new Date(sale.date);
                        return saleDate >= startDate && saleDate <= endDate;
                    });

                    if (filteredSales.length === 0) {
                        this.showToast('ไม่พบรายการขายในช่วงวันที่ที่เลือก', 'info');
                        return;
                    }

                    filteredSales.sort((a, b) => new Date(b.date) - new Date(a.date));

                    let dataRows = [];
                    dataRows.push(['วันที่', 'เวลา', 'รายการสินค้า', 'ราคาต่อหน่วย', 'จำนวน', 'ราคารวมต่อรายการ', 'ยอดขายรวม (บาท)', 'กำไรรวม (บาท)', 'ประเภทชำระ', 'รายละเอียดชำระ', 'กำหนดชำระ', 'ผู้ขาย', 'ร้านค้า']);

                    filteredSales.forEach(sale => {
                        const saleDate = new Date(sale.date);
                        const dateString = this.formatThaiDateFullYear(sale.date);
                        const timeString = `${String(saleDate.getHours()).padStart(2, '0')}:${String(saleDate.getMinutes()).padStart(2, '0')}`;

                        let paymentDetail = '-';
                        if (sale.paymentMethod === 'เครดิต') {
                            paymentDetail = sale.buyerName || '-';
                        } else if (sale.paymentMethod === 'เงินโอน') {
                            paymentDetail = sale.transferorName || '-';
                        }
                        const dueDateString = this.formatThaiDateFullYear(sale.creditDueDate);

                        sale.items.forEach((item, index) => {
                            const itemTotal = item.price * item.quantity;
                            const row = [
                                index === 0 ? dateString : '',
                                index === 0 ? timeString : '',
                                item.name + (item.isSpecialPrice ? ' (พิเศษ)' : ''),
                                this.formatNumberSmart(item.price),
                                this.formatNumberSmart(item.quantity),
                                this.formatNumberSmart(itemTotal),
                                index === 0 ? this.formatNumberSmart(sale.total) : '',
                                index === 0 ? this.formatNumberSmart(sale.profit) : '',
                                index === 0 ? (sale.paymentMethod || 'เงินสด') : '',
                                index === 0 ? paymentDetail : '',
                                index === 0 ? dueDateString : '',
                                index === 0 ? (sale.sellerName || '-') : '',
                                index === 0 ? (sale.storeName || '-') : ''
                            ];
                            dataRows.push(row);
                        });
                    });

                    // สร้างไฟล์ Excel
                    const ws = XLSX.utils.aoa_to_sheet(dataRows);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "ประวัติการขาย");

                    // สร้าง blob และดาวน์โหลด
                    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'binary' });

                    function s2ab(s) {
                        const buf = new ArrayBuffer(s.length);
                        const view = new Uint8Array(buf);
                        for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xFF;
                        return buf;
                    }

                    const blob = new Blob([s2ab(wbout)], { type: "application/octet-stream" });

                    const fileName = `Sales_History_${startDateStr}_to_${endDateStr}.xlsx`;
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = fileName;
                    link.click();
                    URL.revokeObjectURL(link.href);
                    this.showToast(`ส่งออกไฟล์ Excel '${fileName}' สำเร็จ`);
                },
                buildPosSummaryHtml(context) {
                    const { summaryResult, title, thaiDateString, sellerIdFilter, startDate, endDate, dayCount, stockAsOfDate } = context;
                    const isSingleDayReport = startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth() && startDate.getDate() === endDate.getDate();
                    const formatCurrency = (num) => this.formatNumberSmart(num);

                    let dateDisplayString = thaiDateString;
                    if (isSingleDayReport) {
                        const fullDate = this.formatThaiDateFullYear(startDate);
                        dateDisplayString = ` ${fullDate}`;
                    } else if (dayCount) {
                        dateDisplayString = `${thaiDateString} (รวม ${dayCount} วัน)`;
                    }

                    const summaryTimestamp = this.formatThaiTimestamp(new Date());

                    const isSingleSellerReport = !!(sellerIdFilter && sellerIdFilter !== 'all');
                    let allSellersHtml = '';
                    let overallSummaryHtml = '';

                    if (this.currentUser.role === 'admin' && !isSingleSellerReport) {
                        overallSummaryHtml = `
                            <div style="text-align:center;">
                                <div>
                                    <h2>${title}</h2>
                                    <p style="font-size:0.8em; color: #0088ff; margin-bottom: 0;">สรุปโดย : ${this.currentUser.username} | สรุปเมื่อ : ${summaryTimestamp}</p>
                                    <p style="font-size:0.9em; color: #0088ff; font-weight:bold; margin-bottom: 8px;">วันที่ขายสินค้า : ${dateDisplayString}</p>
                                </div>
                                <hr>
                                <h2>ภาพรวมทั้งหมด</h2>
                                <p><strong>ยอดเงินสด :</strong> ${formatCurrency(summaryResult.grandTotalCash)} บาท</p>
                                <p><strong>ยอดเงินโอน :</strong> ${formatCurrency(summaryResult.grandTotalTransfer)} บาท</p>
                                <p><strong>ยอดเครดิต :</strong> ${formatCurrency(summaryResult.grandTotalCredit)} บาท</p>
                                <p><strong>ยอดขายรวมทั้งหมด: ${formatCurrency(summaryResult.grandTotalSales)} บาท</strong></p>
                                ${!isSingleDayReport ? `<p><strong>จำนวนวันขายทั้งหมด : ${summaryResult.totalSellingDays} วัน</strong></p>` : ''}
                                <p style="font-weight: bold; font-size: 1.2em; color: ${summaryResult.grandTotalProfit >= 0 ? 'green' : 'red'};">
                                    <strong>กำไรสุทธิรวม: ${formatCurrency(summaryResult.grandTotalProfit)} บาท</strong>
                                </p>
                            </div>`;
                    }

                    const sellerKeys = Object.keys(summaryResult.sellerSummary);
                    if (this.currentUser.role === 'admin' && !isSingleSellerReport && sellerKeys.length > 0) {
                        allSellersHtml += `<hr style="border-top: 2px solid #333;"><h2 style="border-bottom-color: #607d8b;">รายละเอียดแยกตามผู้ขาย</h2>`;
                    }

                    sellerKeys.forEach((sellerId) => {
                        const sellerData = summaryResult.sellerSummary[sellerId];
                        const sectionTitle = isSingleSellerReport ? title : `สรุปยอดขาย: ${sellerData.sellerName}`;
                        let productTableRows = '';
                        Object.values(sellerData.productSummary).forEach(p => {
                            const stockAtEndOfDay = stockAsOfDate ? stockAsOfDate.get(p.name) : 'N/A';
                            const formattedStock = (typeof stockAtEndOfDay === 'number') ? this.formatNumberSmart(stockAtEndOfDay) : 'N/A';
                            productTableRows += `<tr><td data-label="สินค้า">${p.name}</td><td data-label="เงินสด">${this.formatNumberSmart(p.cashQty)} ${p.unit}</td><td data-label="เงินโอน">${this.formatNumberSmart(p.transferQty)} ${p.unit}</td><td data-label="เครดิต">${this.formatNumberSmart(p.creditQty)} ${p.unit}</td><td data-label="รวม">${this.formatNumberSmart(p.totalQty)} ${p.unit}</td><td data-label="ยอดขาย (บาท)">${formatCurrency(p.totalValue)}</td><td data-label="คงเหลือ">${formattedStock} ${p.unit}</td></tr>`;
                        });

                        let profitOrCommissionHtml;
                        const user = this.data.users.find(u => u.id == sellerId);

                        if (user && user.role === 'seller') {
                            let commission = 0;
                            let commissionText = 'ไม่มีคอมมิชชั่น';

                            if (user.commissionRate > 0) {
                                let commissionBase = 0;
                                let sources = [];
                                if (user.commissionOnCash) {
                                    commissionBase += sellerData.totalCash;
                                    sources.push('เงินสด');
                                }
                                if (user.commissionOnTransfer) {
                                    commissionBase += sellerData.totalTransfer;
                                    sources.push('เงินโอน');
                                }
                                if (user.commissionOnCredit) {
                                    commissionBase += sellerData.totalCredit;
                                    sources.push('เครดิต');
                                }

                                commission = commissionBase * (user.commissionRate / 100);

                                if (sources.length > 0) {
                                    commissionText = `คอมมิชชั่น (${user.commissionRate}% จากขาย${sources.join('+')}) = ${formatCurrency(commission)} บาท`;
                                } else {
                                    commissionText = `ตั้งค่าคอมมิชชั่น ${user.commissionRate}% แต่ไม่ได้เลือกประเภทการขาย`;
                                }
                            }
                            profitOrCommissionHtml = `<p style="font-weight: bold; color: #007bff;"><strong>${commissionText}</strong></p>`;
                        } else { // For admin or if user not found (legacy sales)
                            const profitColor = sellerData.totalProfit >= 0 ? 'green' : 'red';
                            profitOrCommissionHtml = `<p style="color: ${profitColor};"><strong>กำไรรวม: ${formatCurrency(sellerData.totalProfit)} บาท</strong></p>`;
                        }

                        let creditDetailsHtml = '';
                        const creditSalesDetails = this.data.sales.filter(s => s.sellerId == sellerId && s.paymentMethod === 'เครดิต' && new Date(s.date) >= startDate && new Date(s.date) <= endDate);
                        if (creditSalesDetails.length > 0) {
                            let creditRows = '';
                            creditSalesDetails.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(s => {
                                const itemsList = s.items.map(item => {
                                    const product = this.data.products.find(p => p.id === item.productId);
                                    const unit = product ? product.unit : 'หน่วย';
                                    return `${item.name}( ${this.formatNumberSmart(item.quantity)} ${unit} )`;
                                }).join(', ');
                                creditRows += `<tr><td data-label="วันที่">${this.formatThaiDateShortYear(s.date)}</td><td data-label="ผู้ซื้อ">${s.buyerName || '-'}</td><td data-label="รายการ">${itemsList}</td><td data-label="ยอดเงิน(บาท)">${formatCurrency(s.total)}</td><td data-label="กำหนดชำระ">${this.formatThaiDateShortYear(s.creditDueDate)}</td></tr>`;
                            });
                            creditDetailsHtml = `<div style="margin-top: 15px; text-align:center;"><h2>รายละเอียดลูกหนี้ (เครดิต)</h2><table class="credit-details-table credit-details-sub-table"><thead><tr><th>วันที่</th><th>ผู้ซื้อ</th><th>รายการ</th><th>ยอดเงิน(บาท)</th><th>กำหนดชำระ</th></tr></thead><tbody>${creditRows}</tbody></table></div>`;
                        }

                        let transferDetailsHtml = '';
                        const transferSalesDetails = this.data.sales.filter(s => s.sellerId == sellerId && s.paymentMethod === 'เงินโอน' && new Date(s.date) >= startDate && new Date(s.date) <= endDate);
                        if (transferSalesDetails.length > 0) {
                            let transferRows = '';
                            transferSalesDetails.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(s => {
                                const itemsList = s.items.map(item => {
                                    const product = this.data.products.find(p => p.id === item.productId);
                                    const unit = product ? product.unit : 'หน่วย';
                                    return `${item.name}( ${this.formatNumberSmart(item.quantity)} ${unit} )`;
                                }).join(', ');
                                transferRows += `<tr><td data-label="วันที่">${this.formatThaiDateShortYear(s.date)}</td><td data-label="ผู้โอน">${s.transferorName || '-'}</td><td data-label="รายการ">${itemsList}</td><td data-label="ยอดเงิน(บาท)">${formatCurrency(s.total)}</td></tr>`;
                            });
                            transferDetailsHtml = `<div style="margin-top: 15px; text-align:center;"><h2>รายละเอียดเงินโอน</h2><table class="transfer-details-table transfer-details-sub-table"><thead><tr><th>วันที่</th><th>ผู้โอน</th><th>รายการ</th><th>ยอดเงิน(บาท)</th></tr></thead><tbody>${transferRows}</tbody></table></div>`;
                        }

                        allSellersHtml += `
                            <div style="text-align:center; ${!isSingleSellerReport ? 'margin-top: 20px;' : ''}">
                                <h2>${sectionTitle}</h2>
                                ${isSingleSellerReport ? `<p style="font-size:0.8em; color: #0088ff; margin-bottom: 0;">สรุปโดย : ${this.currentUser.username} | สรุปเมื่อ : ${summaryTimestamp}</p>` : ''}
                                <p style="font-size: 0.9em; color: #0088ff; font-weight: bold; margin-bottom: 8px;">วันที่ขายสินค้า : ${dateDisplayString}</p>
                                <p style="margin-bottom: 8px;"><strong>ยอดขายรวม : ${formatCurrency(sellerData.totalSales)} บาท</strong> <br><span style="font-size:0.9em; color: #0088ff;">(เงินสด : ${formatCurrency(sellerData.totalCash)} | เงินโอน : ${formatCurrency(sellerData.totalTransfer)} | เครดิต : ${formatCurrency(sellerData.totalCredit)})</span></p>
                                ${!isSingleDayReport ? `<p><strong>จำนวนวันขายทั้งหมด : ${summaryResult.totalSellingDays} วัน</strong></p>` : ''}
                                ${profitOrCommissionHtml}
                                <table class="product-summary-table">
                                    <thead><tr><th>สินค้า</th><th>เงินสด</th><th>เงินโอน</th><th>เครดิต</th><th>รวม(หน่วย)</th><th>ยอดขาย(บาท)</th><th>คงเหลือ</th></tr></thead>
                                    <tbody>${productTableRows}</tbody>
                                </table>
                                ${creditDetailsHtml}
                                ${transferDetailsHtml}
                            </div>`;
                    });

                    return `${overallSummaryHtml}${allSellersHtml || '<p>ไม่พบข้อมูลการขายในช่วงเวลานี้</p>'}`;
                },
                exportPosSummaryToXlsx(context) {
                    const { summaryResult, title, thaiDateString, periodName, sellerIdFilter, startDate, endDate, stockAsOfDate, dayCount } = context;
                    const isSingleDayReport = startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth() && startDate.getDate() === endDate.getDate();
                    let dataRows = [];

                    const now = new Date();
                    const year = now.getFullYear();
                    const month = String(now.getMonth() + 1).padStart(2, '0');
                    const day = String(now.getDate()).padStart(2, '0');
                    const hours = String(now.getHours()).padStart(2, '0');
                    const minutes = String(now.getMinutes()).padStart(2, '0');
                    const summaryDateTime = `${day}/${month}/${year+543} ${hours}:${minutes} น.`;

                    const isSingleSellerReport = !!(sellerIdFilter && sellerIdFilter !== 'all');

                    // Add header information
                    dataRows.push([title]);
                    dataRows.push(['ช่วงวันที่:', thaiDateString]);
                    dataRows.push(['สรุปเมื่อ:', summaryDateTime]);
                    dataRows.push([]);

                    // Add overall summary for admin view
                    if (this.currentUser.role === 'admin' && !isSingleSellerReport) {
                        dataRows.push(['--- ภาพรวมทั้งหมด ---']);
                        dataRows.push(['ยอดเงินสด (บาท)', this.formatNumberSmart(summaryResult.grandTotalCash)]);
                        dataRows.push(['ยอดเงินโอน (บาท)', this.formatNumberSmart(summaryResult.grandTotalTransfer)]);
                        dataRows.push(['ยอดเครดิต (บาท)', this.formatNumberSmart(summaryResult.grandTotalCredit)]);
                        dataRows.push(['ยอดขายรวมทั้งหมด (บาท)', this.formatNumberSmart(summaryResult.grandTotalSales)]);
                        if (!isSingleDayReport) {
                            dataRows.push(['จำนวนวันขายทั้งหมด (วัน)', summaryResult.totalSellingDays]);
                        }
                        dataRows.push(['กำไรสุทธิรวม (บาท)', this.formatNumberSmart(summaryResult.grandTotalProfit)]);
                        dataRows.push([]);
                    }

                    // Add seller-specific data
                    for (const sellerId in summaryResult.sellerSummary) {
                        const sellerData = summaryResult.sellerSummary[sellerId];
                        
                        if (dataRows.length > 0) dataRows.push([]);
                        
                        dataRows.push([`--- สรุปยอดขาย: ${sellerData.sellerName} ---`]);
                        dataRows.push(['ยอดขายรวม (บาท)', this.formatNumberSmart(sellerData.totalSales)]);
                        dataRows.push(['ยอดเงินสด (บาท)', this.formatNumberSmart(sellerData.totalCash)]);
                        dataRows.push(['ยอดเงินโอน (บาท)', this.formatNumberSmart(sellerData.totalTransfer)]);
                        dataRows.push(['ยอดเครดิต (บาท)', this.formatNumberSmart(sellerData.totalCredit)]);
                        
                        // แก้ไข: ใช้ summaryResult.totalSellingDays แทน sellerData.totalSellingDays
                        if (!isSingleDayReport) {
                            dataRows.push(['จำนวนวันขายทั้งหมด (วัน)', summaryResult.totalSellingDays]);
                        }

                        const user = this.data.users.find(u => u.id == sellerId);
                        if (user && user.role === 'seller') {
                            let commission = 0;
                            let commissionLabel = 'คอมมิชชั่น (บาท)';

                            if (user.commissionRate > 0) {
                                let commissionBase = 0;
                                let sources = [];
                                if (user.commissionOnCash) {
                                    commissionBase += sellerData.totalCash;
                                    sources.push('เงินสด');
                                }
                                if (user.commissionOnTransfer) {
                                    commissionBase += sellerData.totalTransfer;
                                    sources.push('เงินโอน');
                                }
                                if (user.commissionOnCredit) {
                                    commissionBase += sellerData.totalCredit;
                                    sources.push('เครดิต');
                                }

                                commission = commissionBase * (user.commissionRate / 100);

                                if (sources.length > 0) {
                                    commissionLabel = `คอมมิชชั่น (${user.commissionRate}% จาก ${sources.join('+')}) (บาท)`;
                                }
                            }
                            dataRows.push([commissionLabel, this.formatNumberSmart(commission)]);
                        } else {
                            dataRows.push(['กำไรรวม (บาท)', this.formatNumberSmart(sellerData.totalProfit)]);
                        }

                        dataRows.push([]);
                        dataRows.push(['สินค้า', 'ขาย(เงินสด)', 'ขาย(เงินโอน)', 'ขาย(เครดิต)', 'รวม(หน่วย)', 'ยอดขาย(บาท)', 'คงเหลือ']);
                        
                        Object.values(sellerData.productSummary).forEach(p => {
                            const stockAtEndOfDay = stockAsOfDate ? stockAsOfDate.get(p.name) : 'N/A';
                            const formattedStock = (typeof stockAtEndOfDay === 'number') ? this.formatNumberSmart(stockAtEndOfDay) : 'N/A';
                            dataRows.push([
                                p.name, 
                                `${this.formatNumberSmart(p.cashQty)} ${p.unit}`, 
                                `${this.formatNumberSmart(p.transferQty)} ${p.unit}`, 
                                `${this.formatNumberSmart(p.creditQty)} ${p.unit}`, 
                                `${this.formatNumberSmart(p.totalQty)} ${p.unit}`, 
                                this.formatNumberSmart(p.totalValue), 
                                `${formattedStock} ${p.unit}`
                            ]);
                        });

                        // Add credit details if available
                        const creditSalesDetails = this.data.sales.filter(s => 
                            s.sellerId == sellerId && 
                            s.paymentMethod === 'เครดิต' && 
                            new Date(s.date) >= startDate && 
                            new Date(s.date) <= endDate
                        );

                        if (creditSalesDetails.length > 0) {
                            dataRows.push([]);
                            dataRows.push(['--- รายละเอียดลูกหนี้ (เครดิต) ---']);
                            dataRows.push(['วันที่', 'ผู้ซื้อ', 'รายการ', 'ยอดเงิน(บาท)', 'กำหนดชำระ']);
                            
                            creditSalesDetails.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(s => {
                                const itemsList = s.items.map(item => {
                                    const product = this.data.products.find(p => p.id === item.productId);
                                    const unit = product ? product.unit : 'หน่วย';
                                    return `${item.name}(${this.formatNumberSmart(item.quantity)} ${unit})`;
                                }).join('; ');
                                
                                dataRows.push([
                                    this.formatThaiDateFullYear(s.date),
                                    s.buyerName || '-',
                                    itemsList,
                                    this.formatNumberSmart(s.total),
                                    this.formatThaiDateFullYear(s.creditDueDate)
                                ]);
                            });
                        }

                        // Add transfer details if available
                        const transferSalesDetails = this.data.sales.filter(s => 
                            s.sellerId == sellerId && 
                            s.paymentMethod === 'เงินโอน' && 
                            new Date(s.date) >= startDate && 
                            new Date(s.date) <= endDate
                        );

                        if (transferSalesDetails.length > 0) {
                            dataRows.push([]);
                            dataRows.push(['--- รายละเอียดเงินโอน ---']);
                            dataRows.push(['วันที่', 'ผู้โอน', 'รายการ', 'ยอดเงิน(บาท)']);
                            
                            transferSalesDetails.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(s => {
                                const itemsList = s.items.map(item => {
                                    const product = this.data.products.find(p => p.id === item.productId);
                                    const unit = product ? product.unit : 'หน่วย';
                                    return `${item.name}(${this.formatNumberSmart(item.quantity)} ${unit})`;
                                }).join('; ');
                                
                                dataRows.push([
                                    this.formatThaiDateFullYear(s.date),
                                    s.transferorName || '-',
                                    itemsList,
                                    this.formatNumberSmart(s.total)
                                ]);
                            });
                        }
                    }

                    // สร้างไฟล์ Excel
                    const ws = XLSX.utils.aoa_to_sheet(dataRows);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "สรุปภาพรวม");

                    // ปรับความกว้างของคอลัมน์ให้พอดีกับเนื้อหา
                    const colWidths = [];
                    dataRows.forEach(row => {
                        row.forEach((cell, colIndex) => {
                            const cellLength = cell ? cell.toString().length : 0;
                            if (!colWidths[colIndex] || cellLength > colWidths[colIndex]) {
                                colWidths[colIndex] = Math.min(cellLength, 50); // จำกัดความกว้างสูงสุดที่ 50
                            }
                        });
                    });

                    ws['!cols'] = colWidths.map(width => ({ width: width + 2 }));

                    // สร้าง blob และดาวน์โหลด
                    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'binary' });

                    function s2ab(s) {
                        const buf = new ArrayBuffer(s.length);
                        const view = new Uint8Array(buf);
                        for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xFF;
                        return buf;
                    }

                    const blob = new Blob([s2ab(wbout)], { type: "application/octet-stream" });

                    const fileName = `POS_Summary_${periodName}_${new Date().getTime()}.xlsx`;
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = fileName;
                    link.click();
                    URL.revokeObjectURL(link.href);
                    this.showToast(`ส่งออกไฟล์ Excel '${fileName}' สำเร็จ`);
                },

                // --- POS (POINT OF SALE) ---
renderPos(payload = null) {
                    this.editingSaleContext = null;
                    const productSelect = document.getElementById('pos-product');
                    if (!productSelect) return;

                    let availableProducts = this.data.products;
                    if (this.currentUser.role === 'seller') {
                        const assignedIds = this.currentUser.assignedProductIds || [];
                        availableProducts = availableProducts.filter(p => assignedIds.includes(p.id));
                    }
                    const productsInStock = availableProducts.filter(p => p.stock > 0);

                    if (this.currentUser.role === 'seller' && productsInStock.length === 1) {
                        const singleProduct = productsInStock[0];
                        productSelect.innerHTML = `<option value="${singleProduct.id}">${singleProduct.name} (คงเหลือ: ${this.formatNumberSmart(singleProduct.stock)})</option>`;
                        productSelect.disabled = true;
                        productSelect.classList.add('single-product-seller');
                    } else {
                        productSelect.innerHTML = '<option value="">--- เลือกสินค้า ---</option>';
                        productsInStock.forEach(p => {
                            productSelect.innerHTML += `<option value="${p.id}">${p.name} (คงเหลือ: ${this.formatNumberSmart(p.stock)})</option>`;
                        });
                        productSelect.disabled = false;
                        productSelect.classList.remove('single-product-seller');
                    }

                    // --- กำหนดค่าเริ่มต้นสำหรับ Date/Time ---
                    const now = new Date();
                    const dateString = now.toISOString().split('T')[0];
                    const timeString = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                    
                    if (payload) { // โหมดแก้ไขรายการขาย
                        this.editingSaleContext = {
                            sellerId: payload.sellerId,
                            sellerName: payload.sellerName,
                            storeId: payload.storeId,
                            storeName: payload.storeName
                        };
                        this.cart = [];
                        payload.items.forEach(item => {
                            const product = this.data.products.find(p => p.id === item.productId);
                            if (product) {
                                const costAtTimeOfSale = (typeof item.cost === 'number' && !isNaN(item.cost)) ? item.cost : product.costPrice;
                                this.cart.push({
                                    id: product.id,
                                    name: product.name,
                                    quantity: item.quantity,
                                    sellingPrice: item.price,
                                    costPrice: costAtTimeOfSale,
                                    isSpecialPrice: item.isSpecialPrice,
                                    originalPrice: item.originalPrice
                                });
                            }
                        });

                        if (payload.paymentMethod === 'เครดิต') {
                            document.querySelector('input[name="payment-method"][value="เครดิต"]').checked = true;
                            document.getElementById('credit-buyer-name').value = payload.buyerName || '';
                            if (payload.creditDueDate && payload.date) {
                                const saleD = new Date(payload.date);
                                const dueD = new Date(payload.creditDueDate);
                                const timeDiff = dueD.getTime() - saleD.getTime();
                                const dayDiff = Math.round(timeDiff / (1000 * 3600 * 24));
                                document.getElementById('credit-due-days').value = dayDiff >= 0 ? dayDiff : '';
                            } else {
                                document.getElementById('credit-due-days').value = '';
                            }
                        } else if (payload.paymentMethod === 'เงินโอน') {
                            document.querySelector('input[name="payment-method"][value="เงินโอน"]').checked = true;
                            document.getElementById('transfer-name').value = payload.transferorName || '';
                        } else {
                            document.querySelector('input[name="payment-method"][value="เงินสด"]').checked = true;
                        }

                        document.getElementById('pos-date').value = payload.date.split('T')[0];
                        const d = new Date(payload.date);
                        document.getElementById('pos-time').value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                    } else {
                        const dateInput = document.getElementById('pos-date');
                        const timeInput = document.getElementById('pos-time');
                        
                        // กำหนดค่าเริ่มต้นเป็น วันที่/เวลาปัจจุบัน
                        if (!dateInput.value) { dateInput.value = dateString; }
                        if (!timeInput.value) { timeInput.value = timeString; }
                        
                        // หากเป็นการเริ่มทำรายการใหม่ (ตะกร้าว่าง)
                        if (this.cart.length === 0) {
                            document.querySelector('input[name="payment-method"][value="เงินสด"]').checked = true;
                            document.getElementById('pos-date').classList.remove('backdating-active');
                            document.getElementById('pos-time').classList.remove('backdating-active');
                        }
                    }
                    this.renderCart();
                    this.togglePaymentDetailFields();
                    this.updateSpecialPriceInfo();
                },
                renderCart() {
                    const tbody = document.querySelector('#cart-table tbody');
                    if (!tbody) return;
                    tbody.innerHTML = '';
                    let total = 0;
                    this.cart.forEach((item, index) => {
                        const tr = document.createElement('tr');
                        const itemTotal = item.sellingPrice * item.quantity;
                        total += itemTotal;
                        let itemName = item.name;
                        if (item.isSpecialPrice) {
                            itemName += ` <span style="font-weight:bold;">(พิเศษ)</span>`;
                        }
                        tr.innerHTML = `<td data-label="สินค้า">${itemName}</td><td data-label="ราคาฯ">${this.formatNumberSmart(item.sellingPrice)}</td><td data-label="จำนวน">${this.formatNumberSmart(item.quantity)}</td><td data-label="รวม">${this.formatNumberSmart(itemTotal)}</td><td data-label="ลบ"><div class="action-buttons"><button class="danger remove-from-cart-btn" data-index="${index}">ลบ</button></div></td>`;
                        tbody.appendChild(tr);
                    });
                    document.getElementById('cart-total').textContent = `฿${this.formatNumberSmart(total)}`;
                },
                addToCart(e) {
                    e.preventDefault();
                    const productId = document.getElementById('pos-product').value;
                    if (!productId) {
                        this.showToast('กรุณาเลือกสินค้า');
                        return;
                    }
                    const quantity = parseInt(document.getElementById('pos-quantity').value);
                    const product = this.data.products.find(p => p.id == productId);
                    if (quantity > product.stock) {
                        this.showToast('สินค้าในสต็อกไม่เพียงพอ');
                        return;
                    }
                    const specialPriceInput = document.getElementById('special-price');
                    let sellingPrice = product.sellingPrice;
                    let isSpecialPrice = false;
                    if (specialPriceInput.parentElement.parentElement.style.display !== 'none' && specialPriceInput.value.trim() !== '') {
                        const newPrice = parseFloat(specialPriceInput.value);
                        if (!isNaN(newPrice) && newPrice >= 0) {
                            sellingPrice = newPrice;
                            isSpecialPrice = true;
                        }
                    }
                    const existingCartItem = this.cart.find(item => item.id === product.id && item.sellingPrice === sellingPrice);
                    if (existingCartItem) {
                        existingCartItem.quantity += quantity;
                    } else {
                        this.cart.push({
                            id: product.id,
                            name: product.name,
                            quantity: quantity,
                            sellingPrice: sellingPrice,
                            costPrice: product.costPrice,
                            isSpecialPrice: isSpecialPrice,
                            originalPrice: product.sellingPrice
                        });
                    }
                    this.renderCart();
                    const productSelect = document.getElementById('pos-product');
                    if (!productSelect.disabled) {
                        productSelect.value = '';
                    }
                    document.getElementById('pos-quantity').value = 1;
                    document.getElementById('special-price').value = '';
                    this.updateSpecialPriceInfo();
                },
                removeFromCart(index) { this.cart.splice(index, 1); this.renderCart(); },
                processSale() {
                    if (this.cart.length === 0) {
                        this.showToast('ตะกร้าว่างเปล่า');
                        return;
                    }
                    try {
                        const paymentMethod = document.querySelector('input[name="payment-method"]:checked').value;
                        let buyerName = null, creditDueDateValue = null, transferorName = null;

                        if (paymentMethod === 'เครดิต') {
                            const buyerNameInput = document.getElementById('credit-buyer-name');
                            buyerName = buyerNameInput.value.trim();
                            if (!buyerName) {
                                this.showToast('สำหรับรายการเครดิต กรุณาระบุชื่อผู้ซื้อ');
                                buyerNameInput.focus();
                                return;
                            }
                            const creditDaysInput = document.getElementById('credit-due-days').value;
                            const creditDays = parseInt(creditDaysInput);
                            if (!isNaN(creditDays) && creditDays >= 0) {
                                const dueDate = new Date();
                                dueDate.setDate(dueDate.getDate() + creditDays);
                                creditDueDateValue = dueDate.toISOString();
                            }
                        } else if (paymentMethod === 'เงินโอน') {
                            const transferorNameInput = document.getElementById('transfer-name');
                            transferorName = transferorNameInput.value.trim();
                            if (!transferorName) {
                                this.showToast('สำหรับรายการเงินโอน กรุณาระบุชื่อผู้โอน');
                                transferorNameInput.focus();
                                return;
                            }
                        }

                        let saleDate = new Date();
                        const dateInput = document.getElementById('pos-date').value;
                        const timeInput = document.getElementById('pos-time').value;
                        const isBackdatedSale = dateInput || timeInput;

                        if (dateInput) {
                            const [year, month, day] = dateInput.split('-');
                            saleDate.setFullYear(parseInt(year), parseInt(month) - 1, parseInt(day));
                        }
                        if (timeInput) {
                            const [hours, minutes] = timeInput.split(':');
                            saleDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                        }

                        if (paymentMethod === 'เครดิต' && creditDueDateValue) {
                            const creditDays = parseInt(document.getElementById('credit-due-days').value);
                            if (!isNaN(creditDays) && creditDays >= 0) {
                                const dueDate = new Date(saleDate);
                                dueDate.setDate(dueDate.getDate() + creditDays);
                                creditDueDateValue = dueDate.toISOString();
                            }
                        }

                        let totalSale = 0, totalCost = 0;
                        const saleItems = this.cart.map(item => {
                            const product = this.data.products.find(p => p.id === item.id);
                            if (product) {
                                if (item.quantity > product.stock) {
                                    throw new Error(`สินค้าไม่พอ: ${product.name}`);
                                }
                                product.stock -= item.quantity;
                            }
                            totalSale += item.sellingPrice * item.quantity;
                            totalCost += item.costPrice * item.quantity;
                            return {
                                productId: item.id,
                                name: item.name,
                                quantity: item.quantity,
                                price: item.sellingPrice,
                                cost: item.costPrice,
                                isSpecialPrice: item.isSpecialPrice,
                                originalPrice: item.originalPrice
                            };
                        });

                        const sellerAndStoreInfo = {};
                        if (this.editingSaleContext) {
                            sellerAndStoreInfo.sellerId = this.editingSaleContext.sellerId;
                            sellerAndStoreInfo.sellerName = this.editingSaleContext.sellerName;
                            sellerAndStoreInfo.storeId = this.editingSaleContext.storeId;
                            sellerAndStoreInfo.storeName = this.editingSaleContext.storeName;
                        } else {
                            sellerAndStoreInfo.sellerId = this.currentUser.id;
                            sellerAndStoreInfo.sellerName = this.currentUser.username;
                            const store = this.data.stores.find(s => s.id === this.currentUser.storeId);
                            sellerAndStoreInfo.storeId = store ? store.id : null;
                            sellerAndStoreInfo.storeName = store ? store.name : null;
                        }

                        const saleRecord = {
                            id: Date.now(),
                            date: saleDate.toISOString(),
                            items: saleItems,
                            total: totalSale,
                            profit: totalSale - totalCost,
                            paymentMethod,
                            buyerName: buyerName,
                            creditDueDate: creditDueDateValue,
                            transferorName: transferorName,
                            sellerId: sellerAndStoreInfo.sellerId,
                            sellerName: sellerAndStoreInfo.sellerName,
                            storeId: sellerAndStoreInfo.storeId,
                            storeName: sellerAndStoreInfo.storeName
                        };

                        this.data.sales.push(saleRecord);
                        this.saveData();
                        this.cart = [];
                        this.editingSaleContext = null;

                        if (isBackdatedSale) {
                            this.renderCart();
                            document.getElementById('pos-product').value = '';
                            document.getElementById('pos-quantity').value = 1;
                            document.getElementById('special-price').value = '';
                            this.updateSpecialPriceInfo();
                        } else {
                            this.renderPos();
                        }

                        this.showToast('✓ บันทึกการขายสำเร็จ!');
                    } catch (e) {
                        this.showToast(e.message, 'error');
                        console.error(e.message);
                    }
                },
                togglePaymentDetailFields() {
                    const creditFieldsContainer = document.getElementById('credit-fields-container');
                    const transferFieldsContainer = document.getElementById('transfer-fields-container');
                    const paymentMethod = document.querySelector('input[name="payment-method"]:checked').value;

                    if (paymentMethod === 'เครดิต') {
                        creditFieldsContainer.style.display = 'block';
                        transferFieldsContainer.style.display = 'none';
                        document.getElementById('transfer-name').value = '';
                    } else if (paymentMethod === 'เงินโอน') {
                        transferFieldsContainer.style.display = 'block';
                        creditFieldsContainer.style.display = 'none';
                        document.getElementById('credit-buyer-name').value = '';
                        document.getElementById('credit-due-days').value = '';
                    } else { // เงินสด
                        creditFieldsContainer.style.display = 'none';
                        transferFieldsContainer.style.display = 'none';
                        document.getElementById('credit-buyer-name').value = '';
                        document.getElementById('credit-due-days').value = '';
                        document.getElementById('transfer-name').value = '';
                    }
                },
                toggleSpecialPrice() {
                    const container = document.getElementById('special-price-container');
                    const input = document.getElementById('special-price');
                    if (container.style.display === 'none') {
                        container.style.display = 'grid';
                        input.focus();
                    } else {
                        container.style.display = 'none';
                        input.value = '';
                    }
                },
                updateSpecialPriceInfo() {
                    const productId = document.getElementById('pos-product').value;
                    const infoSpan = document.getElementById('current-price-info');
                    if (infoSpan) {
                        if (productId) {
                            const product = this.data.products.find(p => p.id == productId);
                            infoSpan.textContent = `ราคาปกติ: ${this.formatNumberSmart(product.sellingPrice)} บาท`;
                        } else {
                            infoSpan.textContent = '';
                        }
                    }
                },

                // --- SALES HISTORY MANAGEMENT (ADMIN & SELLER) ---
                renderSalesHistory() {
                    const tbody = document.querySelector('#sales-history-table tbody');
                    if (!tbody) return;
                    tbody.innerHTML = '';
                    [...this.data.sales].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(sale => {
                        const tr = document.createElement('tr');
                        const saleDate = new Date(sale.date);
                        const dateString = this.formatThaiDateShortYear(sale.date);
                        const timeString = `${String(saleDate.getHours()).padStart(2, '0')}.${String(saleDate.getMinutes()).padStart(2, '0')} น.`;
                        const itemsList = sale.items.map(item => {
                            let itemText = `${item.name} (x${this.formatNumberSmart(item.quantity)})`;
                            if (item.isSpecialPrice) {
                                itemText += ` <span style="color:red;">(พิเศษ ฿${this.formatNumberSmart(item.price)})</span>`;
                            }
                            return itemText;
                        }).join('<br>');

                        let paymentDisplay = sale.paymentMethod || '-';
                        if (sale.paymentMethod === 'เครดิต' && sale.buyerName) {
                            paymentDisplay = `${sale.paymentMethod} (${sale.buyerName})`;
                        } else if (sale.paymentMethod === 'เงินโอน' && sale.transferorName) {
                            paymentDisplay = `${sale.paymentMethod} (${sale.transferorName})`;
                        }

                        tr.innerHTML = `<td data-label="วันที่">${dateString}</td><td data-label="เวลา">${timeString}</td><td data-label="รายการสินค้า">${itemsList}</td><td data-label="ยอดขายรวม">${this.formatNumberSmart(sale.total)}</td><td data-label="กำไรรวม" style="color:${sale.profit >= 0 ? 'green' : 'red'};">${this.formatNumberSmart(sale.profit)}</td><td data-label="ประเภทชำระ">${paymentDisplay}</td><td data-label="คนขาย">${sale.sellerName}</td><td data-label="ร้านค้า">${sale.storeName || '-'}</td><td data-label="จัดการ"><div class="action-buttons"><button class="edit-sale-btn" data-id="${sale.id}" style="background-color: var(--warning-color);">แก้ไข</button><button class="danger delete-sale-btn" data-id="${sale.id}">ลบ</button></div></td>`;
                        tbody.appendChild(tr);
                    });
                },
                renderSellerSalesHistoryWithFilter() {
                    const tbody = document.querySelector('#seller-sales-history-table tbody');
                    if (!tbody || this.currentUser.role !== 'seller') return;

                    const visibleDays = this.currentUser.visibleSalesDays;
                    let adminCutoffDate = null;

                    if (typeof visibleDays === 'number' && visibleDays >= 0) {
                        adminCutoffDate = new Date();
                        adminCutoffDate.setDate(adminCutoffDate.getDate() - visibleDays);
                        adminCutoffDate.setHours(0, 0, 0, 0);
                    }

                    const filterType = document.querySelector('input[name="seller-filter-type"]:checked').value;
                    let filterStartDate = new Date();
                    let filterEndDate = new Date();

                    switch (filterType) {
                        case 'today':
                            filterStartDate.setHours(0, 0, 0, 0);
                            filterEndDate.setHours(23, 59, 59, 999);
                            break;
                        case 'by_date':
                            const selectedDateStr = document.getElementById('seller-filter-date').value;
                            if (!selectedDateStr) {
                                this.showToast('กรุณาเลือกวันที่', 'warning');
                                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">กรุณาเลือกวันที่ที่ต้องการค้นหา</td></tr>';
                                return;
                            }
                            filterStartDate = new Date(selectedDateStr);
                            filterStartDate.setHours(0, 0, 0, 0);
                            filterEndDate = new Date(selectedDateStr);
                            filterEndDate.setHours(23, 59, 59, 999);
                            break;
                        case 'by_range':
                            const startDateStr = document.getElementById('seller-filter-start-date').value;
                            const endDateStr = document.getElementById('seller-filter-end-date').value;
                            if (!startDateStr || !endDateStr) {
                                this.showToast('กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด', 'warning');
                                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">กรุณาเลือกช่วงวันที่ที่ต้องการค้นหา</td></tr>';
                                return;
                            }
                            filterStartDate = new Date(startDateStr);
                            filterStartDate.setHours(0, 0, 0, 0);
                            filterEndDate = new Date(endDateStr);
                            filterEndDate.setHours(23, 59, 59, 999);
                            break;
                    }

                    if (adminCutoffDate && filterStartDate < adminCutoffDate) {
                        this.showToast(`คุณสามารถดูประวัติได้ไม่เกินวันที่ ${this.formatThaiDateFullYear(adminCutoffDate)}`, 'error');
                        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:red;">อยู่นอกช่วงเวลาที่ได้รับอนุญาต</td></tr>`;
                        return;
                    }

                    const mySales = this.data.sales.filter(sale => {
                        if (sale.sellerId !== this.currentUser.id) return false;
                        const saleDate = new Date(sale.date);
                        return saleDate >= filterStartDate && saleDate <= filterEndDate;
                    });

                    tbody.innerHTML = '';
                    if (mySales.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">ไม่พบรายการขายในช่วงที่เลือก</td></tr>';
                        return;
                    }

                    mySales.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(sale => {
                        const tr = document.createElement('tr');
                        const saleDate = new Date(sale.date);
                        const dateString = this.formatThaiDateShortYear(sale.date);
                        const timeString = `${String(saleDate.getHours()).padStart(2, '0')}.${String(saleDate.getMinutes()).padStart(2, '0')} น.`;
                        const itemsList = sale.items.map(item => `${item.name} (x${this.formatNumberSmart(item.quantity)})`).join('<br>');
                        let paymentDisplay = sale.paymentMethod || '-';
                        if (sale.paymentMethod === 'เครดิต' && sale.buyerName) {
                            paymentDisplay = `${sale.paymentMethod} (${sale.buyerName})`;
                        } else if (sale.paymentMethod === 'เงินโอน' && sale.transferorName) {
                            paymentDisplay = `${sale.paymentMethod} (${sale.transferorName})`;
                        }
                        tr.innerHTML = `
                            <td data-label="วันที่">${dateString}</td>
                            <td data-label="เวลา">${timeString}</td>
                            <td data-label="รายการสินค้า">${itemsList}</td>
                            <td data-label="ยอดขาย">${this.formatNumberSmart(sale.total)}</td>
                            <td data-label="ประเภทชำระ">${paymentDisplay}</td>
                            <td data-label="จัดการ"><div class="action-buttons"><button class="danger seller-delete-sale-btn" data-id="${sale.id}">ลบ</button></div></td>`;
                        tbody.appendChild(tr);
                    });
                },
                editSale(saleId) {
                    const confirmation = confirm("การแก้ไขจะทำการ **ยกเลิก** รายการขายเดิม และนำสินค้าทั้งหมดกลับเข้าตะกร้าเพื่อให้คุณทำรายการใหม่\n\nคุณต้องการดำเนินการต่อหรือไม่?");
                    if (!confirmation) return;
                    const saleToEdit = this.deleteSale(saleId, true);
                    if (!saleToEdit) return;
                    this.showToast('รายการถูกนำกลับเข้าตะกร้าแล้ว กรุณาแก้ไขและยืนยันการขายอีกครั้ง');
                    this.showPage('page-pos', saleToEdit);
                },
                deleteSale(saleId, isEditing = false) {
                    const saleIndex = this.data.sales.findIndex(s => s.id == saleId);
                    if (saleIndex === -1) {
                        this.showToast('ไม่พบรายการขาย');
                        return null;
                    }
                    if (!isEditing) {
                        if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบรายการขายนี้? สต็อกสินค้าจะถูกคืนเข้าระบบ')) return null;
                    }
                    const [saleToDelete] = this.data.sales.splice(saleIndex, 1);
                    saleToDelete.items.forEach(item => {
                        const product = this.data.products.find(p => p.id === item.productId);
                        if (product) {
                            product.stock += item.quantity;
                        }
                    });
                    this.saveData();
                    if (!isEditing) {
                        this.showToast('ลบรายการขายและคืนสต็อกเรียบร้อย');
                    }
                    return saleToDelete;
                },

                // --- PRODUCT MANAGEMENT ---
                renderProductTable() {
                    const tbody = document.querySelector('#product-table tbody');
                    if (!tbody) return;
                    tbody.innerHTML = '';
                    this.data.products.forEach(p => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `<td data-label="ชื่อสินค้า">${p.name}</td>
                                        <td data-label="สต็อก">${this.formatNumberSmart(p.stock)}</td>
                                        <td data-label="หน่วย">${p.unit}</td>
                                        <td data-label="จัดการ">
                                            <div class="action-buttons">
                                                <button class="edit-product-btn" data-id="${p.id}" style="background-color: var(--warning-color);">แก้ไข</button>
                                                <button class="danger delete-product-btn" data-id="${p.id}">ลบ</button>
                                            </div>
                                        </td>`;
                        tbody.appendChild(tr);
                    });
                },
                saveProduct(e) {
                    e.preventDefault();
                    const idValue = document.getElementById('product-id').value;
                    const id = idValue ? parseInt(idValue, 10) : null;

                    const newProductData = {
                        name: document.getElementById('product-name').value,
                        unit: document.getElementById('product-unit').value
                    };

                    if (id) {
                        const index = this.data.products.findIndex(p => p.id === id); 
                        if (index > -1) {
                            const oldProduct = this.data.products[index];
                            const newName = newProductData.name;
                            if (oldProduct.name !== newName) {
                                this.data.sales.forEach(sale => {
                                    sale.items.forEach(item => {
                                        if (item.productId === id) { item.name = newName; }
                                    });
                                });
                                this.data.stockIns.forEach(stockIn => {
                                    if (stockIn.productId === id) { stockIn.productName = newName; }
                                });
                                this.data.stockOuts.forEach(stockOut => {
                                    if (stockOut.productId === id) { stockOut.productName = newName; }
                                });
                                this.showToast('อัปเดตชื่อสินค้าในประวัติย้อนหลังเรียบร้อย');
                            }
                            this.data.products[index].name = newProductData.name;
                            this.data.products[index].unit = newProductData.unit;
                        }
                    } else {
                        newProductData.id = Date.now();
                        newProductData.stock = 0;
                        newProductData.costPrice = 0;
                        newProductData.sellingPrice = 0;
                        this.data.products.push(newProductData);
                    }
                    this.saveData();
                    this.renderProductTable();
                    document.getElementById('product-form').reset();
                    document.getElementById('product-id').value = '';
                },
                editProduct(id) { const product = this.data.products.find(p => p.id == id); if(product) { document.getElementById('product-id').value = product.id; document.getElementById('product-name').value = product.name; document.getElementById('product-unit').value = product.unit; document.getElementById('product-name').focus(); } },
                deleteProduct(id) { if(confirm('คุณแน่ใจหรือไม่ว่าต้องการลบสินค้านี้? การกระทำนี้จะลบสินค้าออกจากระบบ แต่จะไม่ลบประวัติการขายหรือการนำเข้าที่เกี่ยวข้อง')) { this.data.products = this.data.products.filter(p => p.id != id); this.saveData(); this.renderProductTable(); } },

                // --- STOCK MANAGEMENT ---
                calculateStockAsOf(cutoffDate) {
                    const stockSummary = [];

                    this.data.products.forEach(product => {
                        const totalStockIn = this.data.stockIns
                            .filter(si => si.productId === product.id && new Date(si.date) <= cutoffDate)
                            .reduce((sum, si) => sum + si.quantity, 0);

                        const totalSold = this.data.sales
                            .filter(sale => new Date(sale.date) <= cutoffDate)
                            .flatMap(sale => sale.items)
                            .filter(item => item.productId === product.id)
                            .reduce((sum, item) => sum + item.quantity, 0);

                        const totalStockOut = this.data.stockOuts
                            .filter(so => so.productId === product.id && new Date(so.date) <= cutoffDate)
                            .reduce((sum, so) => sum + so.quantity, 0);

                        const calculatedStock = totalStockIn - totalSold - totalStockOut;
                        
                        stockSummary.push({
                            id: product.id,
                            name: product.name,
                            unit: product.unit,
                            stock: calculatedStock
                        });
                    });

                    return stockSummary;
                },
                renderStockIn() { 
                    const productSelect = document.getElementById('stock-in-product'); 
                    if(this.editingStockInId === null) {
                        document.getElementById('stock-in-form').reset();
                    }
                    
                    productSelect.innerHTML = '<option value="">--- เลือกสินค้า ---</option>'; 
                    this.data.products.forEach(p => { productSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`; });
                    
                    const historyTbody = document.querySelector('#stock-in-history-table tbody'); 
                    historyTbody.innerHTML = ''; 
                    [...this.data.stockIns].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(si => { 
                        const tr = document.createElement('tr'); 
                        const stockInDate = new Date(si.date);
                        const dateString = this.formatThaiDateShortYear(si.date);
                        const timeString = `${String(stockInDate.getHours()).padStart(2, '0')}.${String(stockInDate.getMinutes()).padStart(2, '0')} น.`;
                        tr.innerHTML = `<td data-label="วันที่">${dateString}</td>
                                        <td data-label="เวลา">${timeString}</td>
                                        <td data-label="สินค้า">${si.productName}</td>
                                        <td data-label="จำนวน">${this.formatNumberSmart(si.quantity)}</td>
                                        <td data-label="ทุนต่อหน่วย">${this.formatNumberSmart(si.costPerUnit)}</td>
                                        <td data-label="ยอดรวม">${this.formatNumberSmart(si.quantity * si.costPerUnit)}</td>
                                        <td data-label="จัดการ">
                                             <div class="action-buttons">
                                                <button class="edit-stock-in-btn" data-id="${si.id}" style="background-color: var(--warning-color);">แก้ไข</button>
                                                <button class="danger delete-stock-in-btn" data-id="${si.id}">ลบ</button>
                                            </div>
                                        </td>`; 
                        historyTbody.appendChild(tr); 
                    }); 
                },
                saveStockIn(e) {
                    e.preventDefault();
                    const form = document.getElementById('stock-in-form');
                    const productId = document.getElementById('stock-in-product').value;
                    const newQuantity = parseInt(document.getElementById('stock-in-quantity').value);
                    const newCostPrice = parseFloat(document.getElementById('stock-in-cost').value);
                    const newSellingPrice = parseFloat(document.getElementById('stock-in-price').value);

                    if (!productId) { this.showToast('กรุณาเลือกสินค้า', 'error'); return; }
                    if (isNaN(newQuantity) || newQuantity <= 0) { this.showToast('กรุณากรอกจำนวนให้ถูกต้อง', 'error'); return; }
                    if (isNaN(newCostPrice) || newCostPrice < 0) { this.showToast('กรุณากรอกราคาทุนให้ถูกต้อง', 'error'); return; }
                    if (isNaN(newSellingPrice) || newSellingPrice < 0) { this.showToast('กรุณากรอกราคาขายให้ถูกต้อง', 'error'); return; }
                    
                    const product = this.data.products.find(p => p.id == productId);
                    if (!product) { this.showToast('ไม่พบสินค้า', 'error'); return; }

                    if (this.editingStockInId) {
                        const stockInRecord = this.data.stockIns.find(si => si.id === parseInt(this.editingStockInId, 10));
                        if (!stockInRecord) {
                            this.showToast('ไม่พบรายการนำเข้าที่จะแก้ไข', 'error');
                            this.clearStockInForm();
                            return;
                        }

                        const oldQuantity = stockInRecord.quantity;
                        const quantityDifference = newQuantity - oldQuantity;

                        product.stock += quantityDifference;
                        product.costPrice = newCostPrice;
                        product.sellingPrice = newSellingPrice;
                        stockInRecord.quantity = newQuantity;
                        stockInRecord.costPerUnit = newCostPrice;
                        stockInRecord.productName = product.name;

                        this.showToast(`แก้ไขรายการนำเข้าของ ${product.name} สำเร็จ`);
                    } else {
                        product.stock += newQuantity;
                        product.costPrice = newCostPrice;
                        product.sellingPrice = newSellingPrice;

                        const stockInRecord = {
                            id: Date.now(),
                            date: new Date().toISOString(),
                            productId: product.id,
                            productName: product.name,
                            quantity: newQuantity,
                            costPerUnit: newCostPrice
                        };
                        this.data.stockIns.push(stockInRecord);
                        this.showToast(`นำเข้า ${product.name} สำเร็จ`);
                    }
                    
                    this.saveData();
                    this.clearStockInForm();
                    this.renderStockIn();
                },
                editStockIn(id) {
                    const stockInRecord = this.data.stockIns.find(si => si.id == id);
                    if (stockInRecord) {
                        const product = this.data.products.find(p => p.id === stockInRecord.productId);
                        if (!product) {
                            this.showToast('ไม่พบสินค้าที่เกี่ยวข้องกับรายการนี้', 'error');
                            return;
                        }
                        
                        this.editingStockInId = id;

                        const form = document.getElementById('stock-in-form');
                        document.getElementById('stock-in-product').value = stockInRecord.productId;
                        document.getElementById('stock-in-quantity').value = stockInRecord.quantity;
                        document.getElementById('stock-in-cost').value = stockInRecord.costPerUnit;
                        document.getElementById('stock-in-price').value = product.sellingPrice;
                        
                        document.getElementById('stock-in-product').disabled = true;
                        this.showToast(`กำลังแก้ไขการนำเข้าของ: ${stockInRecord.productName}`, 'warning');
                        form.scrollIntoView({ behavior: 'smooth' });
                    }
                },
                deleteStockIn(id) {
                    const stockInId = parseInt(id, 10);
                    if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบรายการนำเข้านี้? สต็อกสินค้าจะถูกหักออกตามจำนวนที่นำเข้า')) return;
                    
                    const stockInIndex = this.data.stockIns.findIndex(si => si.id === stockInId);
                    if (stockInIndex > -1) {
                        const [stockInToDelete] = this.data.stockIns.splice(stockInIndex, 1);
                        
                        const product = this.data.products.find(p => p.id === stockInToDelete.productId);
                        if (product) {
                            product.stock -= stockInToDelete.quantity;
                        }

                        this.saveData();
                        this.showToast('ลบรายการนำเข้าและปรับสต็อกเรียบร้อยแล้ว');
                        this.renderStockIn();
                    }
                },
                clearStockInForm() {
                    this.editingStockInId = null;
                    const form = document.getElementById('stock-in-form');
                    form.reset();
                    document.getElementById('stock-in-product').disabled = false;
                },
                renderStockOut() { 
                    const productSelect = document.getElementById('stock-out-product'); 
                    if(this.editingStockOutId === null) {
                        document.getElementById('stock-out-form').reset();
                    }
                    productSelect.innerHTML = '<option value="">--- เลือกสินค้า ---</option>'; 
                    this.data.products.forEach(p => { productSelect.innerHTML += `<option value="${p.id}">${p.name} (คงเหลือ: ${this.formatNumberSmart(p.stock)})</option>`; }); 
                    const historyTbody = document.querySelector('#stock-out-history-table tbody'); 
                    historyTbody.innerHTML = ''; 
                    [...this.data.stockOuts].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(so => { 
                        const tr = document.createElement('tr'); 
                        const stockOutDate = new Date(so.date);
                        const dateString = this.formatThaiDateShortYear(so.date);
                        const timeString = `${String(stockOutDate.getHours()).padStart(2, '0')}.${String(stockOutDate.getMinutes()).padStart(2, '0')} น.`;
                        tr.innerHTML = `<td data-label="วันที่">${dateString}</td>
                                        <td data-label="เวลา">${timeString}</td>
                                        <td data-label="สินค้า">${so.productName}</td>
                                        <td data-label="จำนวน">${this.formatNumberSmart(so.quantity)}</td>
                                        <td data-label="เหตุผล">${so.reason}</td>
                                        <td data-label="จัดการ">
                                            <div class="action-buttons">
                                                <button class="edit-stock-out-btn" data-id="${so.id}" style="background-color: var(--warning-color);">แก้ไข</button>
                                                <button class="danger delete-stock-out-btn" data-id="${so.id}">ลบ</button>
                                            </div>
                                        </td>`; 
                        historyTbody.appendChild(tr); 
                    }); 
                },
                saveStockOut(e) { 
                    e.preventDefault(); 
                    const productId = document.getElementById('stock-out-product').value; 
                    const newQuantity = parseInt(document.getElementById('stock-out-quantity').value); 
                    const newReason = document.getElementById('stock-out-reason').value.trim();
                    const product = this.data.products.find(p => p.id == productId); 

                    if (!product) {
                        this.showToast('ไม่พบสินค้า', 'error');
                        return;
                    }
                    if (isNaN(newQuantity) || newQuantity <= 0) {
                        this.showToast('กรุณากรอกจำนวนให้ถูกต้อง', 'error');
                        return;
                    }
                    if (!newReason) {
                        this.showToast('กรุณาระบุเหตุผลในการนำออก', 'error');
                        return;
                    }

                    if (this.editingStockOutId) {
                        const stockOutRecord = this.data.stockOuts.find(so => so.id === parseInt(this.editingStockOutId, 10));
                        if (!stockOutRecord) {
                            this.showToast('ไม่พบรายการที่จะแก้ไข', 'error');
                            this.clearStockOutForm();
                            return;
                        }

                        const oldQuantity = stockOutRecord.quantity;
                        const quantityDifference = newQuantity - oldQuantity;

                        if (quantityDifference > product.stock) {
                            this.showToast('สต็อกไม่เพียงพอสำหรับการแก้ไขนี้', 'error');
                            return;
                        }

                        product.stock -= quantityDifference;
                        stockOutRecord.quantity = newQuantity;
                        stockOutRecord.reason = newReason;
                        stockOutRecord.productName = product.name;

                        this.showToast(`แก้ไขรายการนำออกของ ${product.name} สำเร็จ`);
                    } else {
                        if (newQuantity > product.stock) {
                            this.showToast('สินค้าในสต็อกไม่เพียงพอที่จะนำออก', 'error');
                            return;
                        }
                        product.stock -= newQuantity; 
                        const stockOutRecord = { 
                            id: Date.now(), 
                            date: new Date().toISOString(), 
                            productId: product.id, 
                            productName: product.name, 
                            quantity: newQuantity, 
                            reason: newReason 
                        }; 
                        this.data.stockOuts.push(stockOutRecord); 
                        this.showToast('บันทึกการนำออกสินค้าเรียบร้อย'); 
                    }
                    
                    this.saveData(); 
                    this.clearStockOutForm();
                    this.renderStockOut(); 
                },
                editStockOut(id) {
                    const stockOutRecord = this.data.stockOuts.find(so => so.id == id);
                    if (stockOutRecord) {
                        this.editingStockOutId = id;
                        document.getElementById('stock-out-product').value = stockOutRecord.productId;
                        document.getElementById('stock-out-quantity').value = stockOutOut.quantity;
                        document.getElementById('stock-out-reason').value = stockOutRecord.reason;
                        document.getElementById('stock-out-product').disabled = true;
                        document.getElementById('stock-out-form').scrollIntoView({ behavior: 'smooth' });
                        this.showToast(`กำลังแก้ไขการนำออกของ: ${stockOutRecord.productName}`, 'warning');
                    }
                },
                deleteStockOut(id) {
                    if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบรายการนำออกนี้? สต็อกสินค้าจะถูก **เพิ่มคืน** เข้าระบบ')) return;
                    const stockOutId = parseInt(id, 10);
                    const stockOutIndex = this.data.stockOuts.findIndex(so => so.id === stockOutId);
                    if (stockOutIndex > -1) {
                        const [stockOutToDelete] = this.data.stockOuts.splice(stockOutIndex, 1);
                        const product = this.data.products.find(p => p.id === stockOutToDelete.productId);
                        if (product) {
                            product.stock += stockOutToDelete.quantity;
                        }
                        this.saveData();
                        this.showToast('ลบรายการนำออกและคืนสต็อกเรียบร้อยแล้ว');
                        this.renderStockOut();
                    }
                },
                clearStockOutForm() {
                    this.editingStockOutId = null;
                    const form = document.getElementById('stock-out-form');
                    form.reset();
                    document.getElementById('stock-out-product').disabled = false;
                },
                renderStockSummaryReport() {
                    const container = document.getElementById('stock-summary-report-container');
                    if (!container) return;

              let tableHTML = `<div class="table-container"><table id="stock-summary-table">
                <thead>
                    <tr>
                        <th>สินค้า</th>
                        <th>นำเข้าทั้งหมด</th>
                        <th>ขายไปทั้งหมด</th>
                        <th>ปรับออก</th>
                        <th>สต็อก (คำนวณ)</th>
                        <th>สต็อก (ปัจจุบัน)</th>
                        <th>สถานะ</th>
                    </tr>
                </thead>
                <tbody>`;
            
            let hasDiscrepancy = false;

            this.data.products.forEach(product => {
                const totalStockIn = this.data.stockIns
                    .filter(si => si.productId === product.id)
                    .reduce((sum, si) => sum + si.quantity, 0);
                
                const totalSold = this.data.sales
                    .flatMap(sale => sale.items)
                    .filter(item => item.productId === product.id)
                    .reduce((sum, item) => sum + item.quantity, 0);

                const totalStockOut = this.data.stockOuts
                    .filter(so => so.productId === product.id)
                    .reduce((sum, so) => sum + so.quantity, 0);

                const calculatedStock = totalStockIn - totalSold - totalStockOut;
                const currentStock = product.stock;
                
                const isMatch = (calculatedStock === currentStock);
                if (!isMatch) { hasDiscrepancy = true; }

                tableHTML += `
                    <tr style="${!isMatch ? 'background-color: #ffdddd; color: var(--danger-color); font-weight: bold;' : ''}">
                        <td data-label="สินค้า">${product.name}</td>
                        <td data-label="นำเข้าทั้งหมด">${this.formatNumberSmart(totalStockIn)} ${product.unit}</td>
                        <td data-label="ขายไปทั้งหมด">${this.formatNumberSmart(totalSold)} ${product.unit}</td>
                        <td data-label="ปรับออก">${this.formatNumberSmart(totalStockOut)} ${product.unit}</td>
                        <td data-label="สต็อก (คำนวณ)">${this.formatNumberSmart(calculatedStock)} ${product.unit}</td>
                        <td data-label="สต็อก (ปัจจุบัน)">${this.formatNumberSmart(currentStock)} ${product.unit}</td>
                        <td data-label="สถานะ">${isMatch ? '<span style="color:green;">✓ ตรงกัน</span>' : '✗ ไม่ตรงกัน'}</td>
                    </tr>
                `;
            });

            tableHTML += `</tbody></table></div>`;
            
            let summaryText = hasDiscrepancy 
                ? `<p style="color: var(--danger-color); text-align: center; font-weight: bold;">ตรวจพบสต็อกไม่ตรงกัน! คุณสามารถกดปุ่ม "คำนวณสต็อกใหม่ทั้งหมด" เพื่อแก้ไข</p>`
                : `<p style="color: var(--success-color); text-align: center; font-weight: bold;">ยอดสต็อกทั้งหมดถูกต้อง</p>`;

            container.innerHTML = summaryText + tableHTML;
            this.showToast('สร้างรายงานสต็อกสำเร็จ');
        },
        renderYesterdayStockSummaryReport() {
            const container = document.getElementById('stock-summary-report-container');
            if (!container) return;

            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            yesterday.setHours(23, 59, 59, 999); // ตั้งเวลาเป็นสิ้นสุดของวันเมื่อวาน

            const stockData = this.calculateStockAsOf(yesterday);

            let tableHTML = `
                <h3 style="text-align:center;">รายงานสรุปสต็อก ณ สิ้นวันที่ ${this.formatThaiDateFullYear(yesterday)}</h3>
                <div class="table-container"><table id="yesterday-stock-summary-table">
                <thead>
                    <tr>
                        <th>สินค้า</th>
                        <th>สต็อกคงเหลือ (ณ สิ้นวัน)</th>
                    </tr>
                </thead>
                <tbody>`;
            
            stockData.forEach(product => {
                tableHTML += `
                    <tr>
                        <td data-label="สินค้า">${product.name}</td>
                        <td data-label="สต็อกคงเหลือ">${this.formatNumberSmart(product.stock)} ${product.unit}</td>
                    </tr>
                `;
            });

            tableHTML += `</tbody></table></div>`;
            
            container.innerHTML = tableHTML;
            this.showToast('สร้างรายงานสต็อก ณ สิ้นวันก่อนหน้าสำเร็จ');
        },


        // --- PROFIT/LOSS REPORT (OLD) ---
        renderReport(e) {
            const sellerSelect = document.getElementById('report-seller');
            const previouslySelectedSeller = sellerSelect.value; 

            sellerSelect.innerHTML = '<option value="all">ทั้งหมด</option>';
            this.data.users.forEach(u => {
                sellerSelect.innerHTML += `<option value="${u.id}">${u.username}</option>`;
            });
            
            sellerSelect.value = previouslySelectedSeller || 'all'; 

            const startDate = document.getElementById('report-start-date').value;
            const endDate = document.getElementById('report-end-date').value;
            const sellerId = document.getElementById('report-seller').value; 
            let filteredSales = this.data.sales;
            if (startDate) filteredSales = filteredSales.filter(s => s.date >= new Date(startDate).toISOString());
            if (endDate) {
                const endOfDay = new Date(endDate);
                endOfDay.setHours(23, 59, 59, 999);
                filteredSales = filteredSales.filter(s => s.date <= endOfDay.toISOString());
            }
            if (sellerId !== 'all') filteredSales = filteredSales.filter(s => s.sellerId == sellerId);
            const totalSales = filteredSales.reduce((sum, s) => sum + s.total, 0);
            const totalProfit = filteredSales.reduce((sum, s) => sum + s.profit, 0);
            const totalCost = totalSales - totalProfit;
            document.getElementById('report-total-sales').textContent = `฿${this.formatNumberSmart(totalSales)}`;
            document.getElementById('report-total-cost').textContent = `฿${this.formatNumberSmart(totalCost)}`;
            document.getElementById('report-net-profit').textContent = `฿${this.formatNumberSmart(totalProfit)}`;
            document.getElementById('report-net-profit').style.color = totalProfit >= 0 ? 'var(--success-color)' : 'var(--danger-color)';
        },
        
        // --- SUMMARY PAGE (ADMIN) ---
        renderSummaryPage() {
            const sellerSelect = document.getElementById('summary-seller-select');
            if (sellerSelect) {
                const adminUser = this.data.users.find(u => u.role === 'admin');
                sellerSelect.innerHTML = `<option value="all">-- ผู้ขายทั้งหมด --</option>`;
                if (adminUser) {
                    sellerSelect.innerHTML += `<option value="${adminUser.id}">แอดมิน (${adminUser.username})</option>`;
                }
                this.data.users.filter(u => u.role === 'seller').forEach(user => {
                    sellerSelect.innerHTML += `<option value="${user.id}">${user.username}</option>`;
                });
            }
        },

        // --- STORE MANAGEMENT ---
        renderStoreTable() { const tbody = document.querySelector('#store-table tbody'); tbody.innerHTML = ''; this.data.stores.forEach(s => { const tr = document.createElement('tr'); tr.innerHTML = `<td data-label="ชื่อร้านค้า">${s.name}</td> <td data-label="จัดการ"><div class="action-buttons"><button class="edit-store-btn" data-id="${s.id}" style="background-color: var(--warning-color);">แก้ไข</button><button class="danger delete-store-btn" data-id="${s.id}">ลบ</button></div></td>`; tbody.appendChild(tr); }); },
        saveStore(e) {
            e.preventDefault();
            const id = document.getElementById('store-id').value;
            const name = document.getElementById('store-name').value.trim();
            
            if (!name) {
                this.showToast('กรุณากรอกชื่อร้าน', 'error');
                return;
            }

            if (id) { 
                const storeId = parseInt(id, 10);
                const storeIndex = this.data.stores.findIndex(s => s.id === storeId);
                
                if (storeIndex > -1) {
                    const oldStore = this.data.stores[storeIndex];
                    if (oldStore.name !== name) {
                        this.data.sales.forEach(sale => {
                            if (sale.storeId === storeId) {
                                sale.storeName = name;
                            }
                        });
                        this.showToast('อัปเดตชื่อร้านในประวัติการขายเรียบร้อย');
                    }
                    this.data.stores[storeIndex].name = name;
                    this.showToast('แก้ไขชื่อร้านสำเร็จ', 'success'); 
                }
            } else { 
                this.data.stores.push({ id: Date.now(), name });
                this.showToast('เพิ่มร้านใหม่สำเร็จ');
            }
            
            this.saveData();
            this.renderStoreTable();
            document.getElementById('store-form').reset();
            document.getElementById('store-id').value = '';
        },
        editStore(id) { const store = this.data.stores.find(s => s.id == id); if (store) { document.getElementById('store-id').value = store.id; document.getElementById('store-name').value = store.name; document.getElementById('store-name').focus(); } },
        deleteStore(id) { const isStoreInUse = this.data.users.some(u => u.storeId == id); if (isStoreInUse) { this.showToast('ไม่สามารถลบร้านค้านี้ได้ เนื่องจากมีผู้ใช้สังกัดอยู่', 'error'); return; } if (confirm('คุณแน่ใจหรือไม่ว่าต้องการลบร้านค้านี้?')) { this.data.stores = this.data.stores.filter(s => s.id != id); this.saveData(); this.renderStoreTable(); this.showToast('ลบร้านค้าเรียบร้อย'); } },
        
        // --- USER MANAGEMENT ---
        renderUserTable() {
            const tbody = document.querySelector('#user-table tbody');
            if (!tbody) return; 
            tbody.innerHTML = '';
            this.data.users.forEach(u => {
                let assignedText = 'N/A';
                if (u.role === 'seller') {
                    const assignedIds = u.assignedProductIds || [];
                    if (this.data.products.length > 0 && assignedIds.length === this.data.products.length) assignedText = 'ทั้งหมด';
                    else if (assignedIds.length > 0) assignedText = `${assignedIds.length} รายการ`;
                    else assignedText = 'ยังไม่กำหนด';
                }
                let salesPeriodText = 'N/A';
                if (u.role === 'seller') {
                    const formatDate = (dateStr) => this.formatThaiDateShortYear(dateStr);
                    const start = formatDate(u.salesStartDate);
                    const end = formatDate(u.salesEndDate);
                    if (start !== '-' || end !== '-') {
                        salesPeriodText = `${start !== '-' ? start : 'ไม่กำหนด'} - ${end !== '-' ? end : 'ไม่กำหนด'}`;
                    } else {
                        salesPeriodText = 'ไม่กำหนด';
                    }
                }
                const store = this.data.stores.find(s => s.id === u.storeId);
                const storeName = store ? store.name : 'ยังไม่กำหนด';
                const tr = document.createElement('tr');
                tr.innerHTML = `<td data-label="ชื่อผู้ใช้">${u.username}</td><td data-label="ประเภท">${u.role}</td><td data-label="ร้านค้า">${storeName}</td><td data-label="สินค้าที่ขายได้">${assignedText}</td><td data-label="ระยะเวลาที่ขายได้">${salesPeriodText}</td> <td data-label="จัดการ"><div class="action-buttons"><button class="edit-user-btn" data-id="${u.id}" style="background-color: var(--warning-color);">แก้ไข</button> ${u.username !== 'admin' ? `<button class="danger delete-user-btn" data-id="${u.id}">ลบ</button>` : ''}</div></td>`;
                tbody.appendChild(tr);
            });
            
            this.setupUserForm(); 
        },
        saveUser(e) {
            e.preventDefault();

            const id = document.getElementById('user-id').value;
            const username = document.getElementById('user-username').value;
            const password = document.getElementById('user-password').value;
            const confirmPassword = document.getElementById('user-password-confirm').value;
            const role = document.getElementById('user-role').value;
            const startDate = document.getElementById('user-sales-start-date').value;
            const endDate = document.getElementById('user-sales-end-date').value;

            if (!username.trim()) { this.showToast('กรุณากรอกชื่อผู้ใช้', 'error'); return; }
            if (password !== confirmPassword) { this.showToast('รหัสผ่านไม่ตรงกัน', 'error'); return; }

            let assignedProductIds = [];
            let storeId = null;
            let commissionRate = 0, commissionOnCash = false, commissionOnTransfer = false, commissionOnCredit = false;
            let visibleSalesDays = null;

            if (role === 'seller') {
                const storeSelect = document.getElementById('user-store-select');
                storeId = storeSelect ? storeSelect.value : null;

                if (!storeId) { this.showToast('กรุณาระบุร้านค้าสำหรับผู้ขาย', 'error'); return; }
                storeId = parseInt(storeId, 10); 

                if (!startDate || !endDate) { this.showToast('กรุณากำหนดระยะเวลาการขายให้ครบถ้วน', 'error'); return; }
                if (new Date(startDate) > new Date(endDate)) { this.showToast('วันที่เริ่มขายต้องมาก่อนหรือวันเดียวกับวันที่สิ้นสุด', 'error'); return; }
                const checkboxes = document.querySelectorAll('#user-product-assignment input:checked');
                assignedProductIds = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));

                commissionRate = parseFloat(document.getElementById('user-commission-rate').value) || 0;
                commissionOnCash = document.getElementById('user-commission-cash').checked;
                commissionOnTransfer = document.getElementById('user-commission-transfer').checked;
                commissionOnCredit = document.getElementById('user-commission-credit').checked;

                const visibleDaysInput = document.getElementById('user-visible-days').value;
                if (visibleDaysInput) {
                    const parsedDays = parseInt(visibleDaysInput, 10);
                    if (!isNaN(parsedDays) && parsedDays >= 0) {
                        visibleSalesDays = parsedDays;
                    }
                }
            }

            if (id) {
                const user = this.data.users.find(u => u.id == id);
                if (user.username !== username) {
                    this.data.sales.forEach(sale => {
                        if (sale.sellerId == id) { sale.sellerName = username; }
                    });
                }
                user.username = username;
                if (password) user.password = password;
                user.role = role;

                if (role === 'seller') {
                    user.assignedProductIds = assignedProductIds;
                    user.salesStartDate = startDate;
                    user.salesEndDate = endDate;
                    user.storeId = storeId;
                    user.commissionRate = commissionRate;
                    user.commissionOnCash = commissionOnCash;
                    user.commissionOnTransfer = commissionOnTransfer;
                    user.commissionOnCredit = commissionOnCredit;
                    user.visibleSalesDays = visibleSalesDays;
                } else {
                    delete user.assignedProductIds; delete user.salesStartDate; delete user.salesEndDate; delete user.storeId; delete user.commissionRate; delete user.commissionOnCash; delete user.commissionOnTransfer; delete user.commissionOnCredit; delete user.visibleSalesDays;
                }
                this.showToast('แก้ไขข้อมูลผู้ใช้สำเร็จ');
            } else {
                if (this.data.users.some(u => u.username === username)) { this.showToast('ชื่อผู้ใช้นี้มีอยู่แล้ว', 'error'); return; }
                if (!password) { this.showToast('กรุณากำหนดรหัสผ่านสำหรับผู้ใช้ใหม่', 'error'); return; }
                const newUser = { id: Date.now(), username, password, role };
                if (role === 'seller') {
                    newUser.assignedProductIds = assignedProductIds;
                    newUser.salesStartDate = startDate;
                    newUser.salesEndDate = endDate;
                    newUser.storeId = storeId;
                    newUser.commissionRate = commissionRate;
                    newUser.commissionOnCash = commissionOnCash;
                    newUser.commissionOnTransfer = commissionOnTransfer;
                    newUser.commissionOnCredit = commissionOnCredit;
                    newUser.visibleSalesDays = visibleSalesDays;
                }
                this.data.users.push(newUser);
                this.showToast('เพิ่มผู้ใช้ใหม่สำเร็จ');
            }

            this.saveData();
            this.renderUserTable();
        },
        editUser(id) { 
            const user = this.data.users.find(p => p.id == id);
            if(user) {
                this.setupUserForm(user);
            }
        },
        deleteUser(id) { const user = this.data.users.find(u => u.id == id); if (user && user.username === 'admin') { this.showToast('ไม่สามารถลบผู้ใช้ admin ได้', 'error'); return; } if(confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้ ${user.username}?`)) { this.data.users = this.data.users.filter(u => u.id != id); this.saveData(); this.renderUserTable(); } },
        setupUserForm(user = null) {
            const form = document.getElementById('user-form');
            form.reset();
            document.getElementById('user-password-confirm').value = '';

            const productContainer = document.getElementById('user-product-assignment-container');
            const salesContainer = document.getElementById('user-sales-period-container');
            const storeContainer = document.getElementById('user-store-assignment-container');
            const commissionContainer = document.getElementById('user-commission-settings-container');
            const historyContainer = document.getElementById('user-history-view-container');
            const sellerFields = [productContainer, salesContainer, storeContainer, commissionContainer, historyContainer];

            if (user) {
                document.getElementById('user-id').value = user.id;
                document.getElementById('user-username').value = user.username;
                document.getElementById('user-role').value = user.role;
                document.getElementById('user-password').value = '';
                document.getElementById('user-password').placeholder = 'เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน';
                document.getElementById('user-password-confirm').placeholder = 'เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน';

                if (user.role === 'seller') {
                    sellerFields.forEach(c => c.style.display = 'grid'); // Changed to grid for better mobile layout
                    
                    document.getElementById('user-commission-rate').value = user.commissionRate || 0;
                    document.getElementById('user-commission-cash').checked = user.commissionOnCash || false;
                    document.getElementById('user-commission-transfer').checked = user.commissionOnTransfer || false;
                    document.getElementById('user-commission-credit').checked = user.commissionOnCredit || false;
                    document.getElementById('user-visible-days').value = user.visibleSalesDays ?? '';
                    
                    this.renderUserStoreAssignment(user.storeId);
                    this.renderUserProductAssignment(user.assignedProductIds || []);
                    document.getElementById('user-sales-start-date').value = user.salesStartDate || '';
                    document.getElementById('user-sales-end-date').value = user.salesEndDate || '';
                } else {
                    sellerFields.forEach(c => c.style.display = 'none');
                }
            } else {
                document.getElementById('user-id').value = '';
                document.getElementById('user-password').placeholder = 'กำหนดรหัสผ่านสำหรับผู้ใช้ใหม่';
                document.getElementById('user-password-confirm').placeholder = 'ยืนยันรหัสผ่าน';
                
                // Default to showing seller fields for new user creation unless role is changed
                sellerFields.forEach(c => c.style.display = 'grid');
                
                document.getElementById('user-role').value = 'seller'; // Default to seller for new user form
                document.getElementById('user-commission-rate').value = '';
                document.getElementById('user-commission-cash').checked = false;
                document.getElementById('user-commission-transfer').checked = false;
                document.getElementById('user-commission-credit').checked = false;
                document.getElementById('user-visible-days').value = '';
                this.renderUserStoreAssignment(); 
                this.renderUserProductAssignment(); 
            }
            document.getElementById('user-username').focus();
        },
        renderUserProductAssignment(selectedIds = []) { const container = document.getElementById('user-product-assignment'); if (!container) return; container.innerHTML = ''; if (this.data.products.length === 0) { container.innerHTML = '<p>ยังไม่มีสินค้าในระบบ โปรดเพิ่มสินค้าก่อน</p>'; return; } this.data.products.forEach(p => { const isChecked = selectedIds.includes(p.id); container.innerHTML += `<label class="product-item" style="display: block; margin-bottom: 5px;"><input type="checkbox" value="${p.id}" ${isChecked ? 'checked' : ''}> ${p.name}</label>`; }); },
        renderUserStoreAssignment(selectedStoreId = null) {
            const container = document.getElementById('user-store-assignment-container');
            if (!container) return; 
            container.innerHTML = ''; 
            if (this.data.stores.length === 0) { 
                container.innerHTML = '<p style="text-align: center; color: red;">ยังไม่มีร้านค้าในระบบ! กรุณาไปที่หน้า "จัดการร้านค้า" เพื่อเพิ่มร้านค้าก่อน</p>'; 
                return; 
            } 
            let selectHTML = '<label for="user-store-select">เลือกร้านค้า:</label><select id="user-store-select"><option value="">-- กรุณาเลือกร้านค้า --</option>'; 
            this.data.stores.forEach(s => { 
                const isSelected = s.id == selectedStoreId; 
                selectHTML += `<option value="${s.id}" ${isSelected ? 'selected' : ''}>${s.name}</option>`; 
            }); 
            selectHTML += '</select>'; 
            container.innerHTML = selectHTML; 
        },

// --- DYNAMIC HTML INJECTION (KEEP THIS AS IT WAS IN INDEX.HTML) ---
        fillPages(){ 
            document.getElementById('page-pos').innerHTML = `<h2>ขายสินค้า (Point of Sale)</h2><div class="pos-layout"><div><form id="add-to-cart-form" style="max-width:none;"><label for="pos-date-time-group">วันที่/เวลาขาย:</label><div id="pos-date-time-group" class="date-time-group"><input type="date" id="pos-date"><input type="time" id="pos-time"></div><label for="pos-product">เลือกสินค้า:</label><select id="pos-product" required></select><label for="pos-quantity">จำนวน:</label><input type="number" id="pos-quantity" value="1" min="1" required><div id="special-price-container" style="display: none; grid-column: 1 / -1; grid-template-columns: 150px 1fr; align-items: center; gap: 15px;"><label for="special-price">ราคาขายใหม่:</label><div><input type="number" id="special-price" placeholder="กรอกราคาต่อหน่วย" min="0" step="any"><span id="current-price-info" style="font-size: 0.9em; color: #555; margin-left: 10px;"></span></div></div><div class="form-actions"><button type="submit" class="success">เพิ่มลงตะกร้า</button><button type="button" id="toggle-special-price-btn">ใช้ราคาพิเศษ</button></div></form><h3>รายการในตะกร้า</h3><div class="table-container"><table id="cart-table"><thead><tr><th>สินค้า</th><th>ราคาฯ</th><th>จำนวน</th><th>รวม</th><th>ลบ</th></tr></thead><tbody></tbody></table></div></div><div id="cart-summary"><div id="payment-method-container"><h4>ประเภทการชำระเงิน</h4><div class="payment-options-wrapper"><label><input type="radio" name="payment-method" value="เงินสด" checked> เงินสด</label><label><input type="radio" name="payment-method" value="เงินโอน"> เงินโอน</label><label><input type="radio" name="payment-method" value="เครดิต"> เครดิต</label></div><div id="transfer-fields-container"><div style="margin-top:5px;"><label for="transfer-name" style="text-align:left;font-weight:bold;">ชื่อผู้โอน:</label><input type="text" id="transfer-name"></div></div><div id="credit-fields-container"><div style="margin-top:5px;"><label for="credit-buyer-name" style="text-align:left;font-weight:bold;">ชื่อผู้ซื้อ (เครดิต):</label><input type="text" id="credit-buyer-name"></div><div style="margin-top:5px;"><label for="credit-due-days" style="text-align:left;font-weight:bold;">จำนวนวันเครดิต :</label><input type="number" id="credit-due-days" min="0" placeholder="เช่น 7, 15, 30"></div></div></div><div class="cart-action-row"><span class="cart-total-label">สรุปยอด:</span><div id="cart-total">฿0.00</div><button id="process-sale-btn">ยืนยันการขาย</button></div></div></div>`; 
            
            document.getElementById('page-products').innerHTML = `<h2>จัดการสินค้า</h2> <p style="text-align:center; margin-top:-10px; margin-bottom:15px; font-size:0.9em;">ในหน้านี้ใช้สำหรับสร้างและแก้ไข <b>ชื่อสินค้า</b> และ <b>หน่วยนับ</b> เท่านั้น<br>ราคาทุนและราคาขาย จะถูกกำหนดในหน้า "นำเข้าสินค้า"</p><form id="product-form"> <input type="hidden" id="product-id"> <label for="product-name">ชื่อสินค้า:</label> <input type="text" id="product-name" required> <label for="product-unit">หน่วย:</label> <input type="text" id="product-unit" placeholder="เช่น ชิ้น, กล่อง" required> <div class="form-actions"> <button type="submit" class="success">บันทึกสินค้า</button> <button type="button" id="clear-product-form-btn" style="background-color:#6c757d;">เคลียร์ฟอร์ม</button> </div> </form> <div class="table-container"><table id="product-table"> <thead> <tr><th>ชื่อสินค้า</th><th>สต็อก</th><th>หน่วย</th><th>จัดการ</th></tr> </thead> <tbody></tbody> </table></div>`; 
            
            document.getElementById('page-stock-in').innerHTML = `<h2>บันทึกการนำเข้าสินค้า</h2> <p style="text-align:center; margin-top:-10px; margin-bottom:15px; font-size:0.9em;">เมื่อบันทึกการนำเข้า ราคาทุนและราคาขายล่าสุดของสินค้าจะถูกอัปเดตตามข้อมูลที่กรอกในหน้านี้</p><form id="stock-in-form"> <label for="stock-in-product">เลือกสินค้า:</label> <select id="stock-in-product" required></select> <label for="stock-in-quantity">จำนวน:</label> <input type="number" id="stock-in-quantity" min="1" required> <label for="stock-in-cost">ราคาทุนต่อหน่วย:</label> <input type="number" id="stock-in-cost" min="0" step="0.01" required> <label for="stock-in-price">ราคาขายต่อหน่วย:</label> <input type="number" id="stock-in-price" min="0" step="0.01" required> <div class="form-actions"> <button type="submit" class="success">บันทึก</button> <button type="button" id="clear-stock-in-form-btn" style="background-color:#6c757d;">เคลียร์ฟอร์ม / ยกเลิกแก้ไข</button></div> </form> <h3>ประวัติการนำเข้า</h3> <div class="table-container"><table id="stock-in-history-table"> <thead> <tr><th>วันที่</th><th>เวลา</th><th>สินค้า</th><th>จำนวน</th><th>ทุนต่อหน่วย</th><th>ยอดรวม</th><th>จัดการ</th></tr> </thead> <tbody></tbody> </table></div>`; 
            
            document.getElementById('page-stock-out').innerHTML = `<h2>ปรับสต็อก (นำออก)</h2> <form id="stock-out-form"> <label for="stock-out-product">เลือกสินค้า:</label> <select id="stock-out-product" required></select> <label for="stock-out-quantity">จำนวนที่นำออก:</label> <input type="number" id="stock-out-quantity" min="1" required> <label for="stock-out-reason">เหตุผล:</label> <input type="text" id="stock-out-reason" placeholder="เช่น หมดอายุ, ชำรุด, นับสต็อก" required> <div class="form-actions"> <button type="submit" class="success">บันทึก</button> <button type="button" id="clear-stock-out-form-btn" style="background-color:#6c757d;">เคลียร์ฟอร์ม / ยกเลิกแก้ไข</button> </div> </form> <h3>ประวัติการนำออกล่าสุด</h3> <div class="table-container"><table id="stock-out-history-table"> <thead> <tr><th>วันที่</th><th>เวลา</th><th>สินค้า</th><th>จำนวน</th><th>เหตุผล</th><th>จัดการ</th></tr> </thead> <tbody></tbody> </table></div>`;
            document.getElementById('page-sales-history').innerHTML = `
                <h2>รายการขายย้อนหลัง</h2>
                <div id="sales-history-export-form">
    <label>ตั้งแต่วันที่: <input type="date" id="export-sales-start-date"></label>
    <label>ถึงวันที่: <input type="date" id="export-sales-end-date"></label>
    <button type="button" id="export-sales-history-excel-btn">ส่งออกเป็น Excel</button> </div>
                <div class="table-container">
                    <table id="sales-history-table">
                        <thead>
                            <tr>
                                <th>วันที่</th><th>เวลา</th><th>รายการสินค้า</th><th>ยอดขายรวม</th><th>กำไรรวม</th><th>ประเภทชำระ</th><th>คนขาย</th><th>ร้านค้า</th><th>จัดการ</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>`;
            document.getElementById('page-reports').innerHTML = `<h2>รายงานกำไร/ขาดทุน</h2> <form id="report-filter-form"> <label>ตั้งแต่วันที่:<input type="date" id="report-start-date"></label> <label>ถึงวันที่:<input type="date" id="report-end-date"></label> <label>คนขาย:<select id="report-seller"><option value="all">ทั้งหมด</option></select></label> <button type="submit" id="report-generate-btn">สร้างรายงาน</button> </form> <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 15px; text-align: center;"> <div style="background: #f9f9f9; border: 1px solid var(--border-color); padding: 10px; border-radius: 5px;"> <h3>ยอดขายรวม</h3><p id="report-total-sales" style="font-size: 1.4em; font-weight: bold;">฿0.00</p> </div> <div style="background: #f9f9f9; border: 1px solid var(--border-color); padding: 10px; border-radius: 5px;"> <h3>ต้นทุนรวม</h3><p id="report-total-cost" style="font-size: 1.4em; font-weight: bold;">฿0.00</p> </div> <div style="background: #f9f9f9; border: 1px solid var(--border-color); padding: 10px; border-radius: 5px;"> <h3>กำไรสุทธิ</h3><p id="report-net-profit" style="font-size: 1.4em; font-weight: bold; color: var(--success-color);">฿0.00</p> </div> </div>`; 
            document.getElementById('page-summary').innerHTML = `
                <h2>สรุปข้อมูล (สำหรับแอดมิน)</h2>
                <div class="summary-section" style="margin-bottom: 10px;">
                    <h3 style="text-align:center; border:none; margin-bottom: 10px; font-size:1.1em;">1. เลือกผู้ขาย (จำเป็นสำหรับทุกรายงาน)</h3>
                    <div class="summary-form-inline" style="justify-content: center;">
                        <label for="summary-seller-select">ผู้ขาย:</label>
                        <select id="summary-seller-select" style="text-align: left; max-width: 400px;"></select>
                    </div>
                </div>

                <div class="collapsible-bar active" data-target="admin-quick-summary-content" style="background-color: #00B0F0;"><span>สรุปภาพรวมแบบรวดเร็ว</span><span class="arrow" style="transform: rotate(90deg);">▶</span></div>
                <div id="admin-quick-summary-content" class="collapsible-content active">
                    <div style="text-align:center; padding:5px 0;">
                        <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 15px;">
                            <button id="admin-summary-today-btn" style="background-color: var(--warning-color);">สรุปยอดขายวันนี้</button>
                            <button id="admin-summary-all-btn" style="background-color: #673ab7;">สรุปทั้งหมด</button>
                        </div>
                        <div class="summary-form-inline" style="justify-content: center; flex-direction: column; gap:8px; align-items: stretch; border-top: 1px solid #ddd; padding-top: 10px;">
                            <label>สรุปยอดขายตามวันที่เลือก: <input type="date" id="admin-summary-date" style="width: auto;"></label>
                            <button id="admin-summary-by-day-btn" style="background-color: #03a9f4; max-width: 300px; margin: auto;">สร้างรายงานตามวันที่</button>
                        </div>
                    </div>
                </div>

                <div class="collapsible-bar" data-target="admin-detailed-reports-content" style="background-color: #00B050;"><span>รายงานขั้นสูง (ตามช่วงเวลา)</span><span class="arrow">▶</span></div>
                <div id="admin-detailed-reports-content" class="collapsible-content">
                    <div class="summary-section" id="admin-report-filters" style="border:none; padding: 5px 0;">
                        <h4 style="text-align:center; margin-top:0; font-size:1em;">กำหนดช่วงเวลา</h4>
                        <div class="summary-form-inline" style="justify-content: center;">
                            <label>จากวันที่:</label>
                            <input type="date" id="summary-custom-start-date" required>
                            <label>ถึงวันที่:</label>
                            <input type="date" id="summary-custom-end-date" required>
                        </div>
                    </div>
                    <div class="report-action-buttons" style="gap:10px;">
                         <div class="report-action-item">
                            <p><strong>สรุปภาพรวมตามช่วงเวลา</strong><br><small>(สรุปยอดขาย, กำไร/คอมมิชชั่น, จำนวนสินค้า)</small></p>
                            <button type="button" id="generate-aggregated-summary-btn" style="background-color: #673ab7;">สร้างรายงานสรุปภาพรวม</button>
                        </div>
                        <div class="report-action-item">
                            <p><strong>แจกแจงรายละเอียดการขาย</strong><br><small>(แสดงรายการขายทั้งหมดในช่วงเวลาที่เลือก)</small></p>
                            <div id="summary-payment-types" style="display: flex; gap: 10px; flex-wrap: wrap; padding: 8px; background-color: #eef5ff; border-radius: 6px; justify-content: center; margin-bottom: 8px; font-size:0.9em;">
                                <label style="font-weight:normal;"><input type="checkbox" value="เงินสด" checked> เงินสด</label>
                                <label style="font-weight:normal;"><input type="checkbox" value="เงินโอน" checked> เงินโอน</label>
                                <label style="font-weight:normal;"><input type="checkbox" value="เครดิต" checked> เครดิต</label>
                            </div>
                            <button type="button" id="generate-detailed-report-btn" class="success">สร้างรายงานแจกแจง</button>
                        </div>
                        <div class="report-action-item">
                            <p><strong>สรุปข้อมูลลูกหนี้ (เครดิต)</strong></p>
                            <button type="button" id="generate-credit-summary-btn" class="danger">สร้างรายงานลูกหนี้</button>
                        </div>
                        <div class="report-action-item">
                            <p><strong>สรุปข้อมูลเงินโอน</strong></p>
                            <button type="button" id="generate-transfer-summary-btn" style="background-color: #007bff;">สร้างรายงานเงินโอน</button>
                        </div>
                    </div>
                </div>`;
            document.getElementById('page-stores').innerHTML = `<h2>จัดการร้านค้า</h2> <form id="store-form"> <input type="hidden" id="store-id"> <label for="store-name">ชื่อร้านค้า:</label> <input type="text" id="store-name" required> <div class="form-actions"> <button type="submit" class="success">บันทึกร้านค้า</button> <button type="button" id="clear-store-form-btn" style="background-color:#6c757d;">เคลียร์ฟอร์ม</button> </div> </form> <div class="table-container"><table id="store-table"> <thead> <tr><th>ชื่อร้านค้า</th><th>จัดการ</th></tr> </thead> <tbody></tbody> </table></div>`;
            
            document.getElementById('page-users').innerHTML = `<h2>จัดการผู้ใช้</h2> 
                <form id="user-form"> 
                    <input type="hidden" id="user-id"> 
                    <div class="form-group"><label for="user-username">ชื่อผู้ใช้:</label><input type="text" id="user-username" required></div>
                    <div class="form-group"><label for="user-password">รหัสผ่านใหม่:</label><input type="password" id="user-password" placeholder="เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน"></div>
                    <div class="form-group"><label for="user-password-confirm">ยืนยันรหัสผ่าน:</label><input type="password" id="user-password-confirm" placeholder="เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน"></div>
                    <div class="form-group">
                        <label style="font-weight:normal; display:block; cursor:pointer;">
                            <input type="checkbox" id="show-password-user-form"> แสดงรหัสผ่าน
                        </label>
                    </div>
                    <div class="form-group"><label for="user-role">ประเภท:</label><select id="user-role" required> <option value="seller">Seller</option> <option value="admin">Admin</option> </select></div>
                    <div id="user-store-assignment-container" class="form-group"></div>
                    <div id="user-commission-settings-container" class="form-group"> 
                        <h4>ตั้งค่าคอมมิชชั่น</h4>
                        <div class="form-group"><label for="user-commission-rate">อัตรา (%):</label><input type="number" id="user-commission-rate" min="0" max="100" step="any" placeholder="เช่น 3, 5.5"></div>
                        <div class="form-group">
                            <label>คิดจากยอดขาย:</label>
                            <div id="user-commission-sources"> 
                                <label><input type="checkbox" id="user-commission-cash"> เงินสด</label> 
                                <label><input type="checkbox" id="user-commission-transfer"> เงินโอน</label> 
                                <label><input type="checkbox" id="user-commission-credit"> เครดิต</label> 
                            </div>
                        </div>
                    </div> 
                    <div id="user-history-view-container" class="form-group"> 
                        <h4>ตั้งค่าการแสดงผลประวัติ</h4>
                        <div class="form-group"><label for="user-visible-days">จำนวนวันที่ดูประวัติขายได้:</label><input type="number" id="user-visible-days" min="0" placeholder="0=วันนี้, 1=วันนี้และเมื่อวาน (เว้นว่าง=ทั้งหมด)"></div>
                    </div> 
                    <div id="user-sales-period-container" class="form-group">
                        <h4>กำหนดระยะเวลาที่สามารถขายได้</h4> 
                        <div class="form-group"><label for="user-sales-start-date">วันที่เริ่มขาย:</label><input type="date" id="user-sales-start-date"></div>
                        <div class="form-group"><label for="user-sales-end-date">วันที่สิ้นสุด:</label><input type="date" id="user-sales-end-date"></div>
                    </div> 
                    <div id="user-product-assignment-container" class="form-group"> 
                        <h4>กำหนดสินค้าที่สามารถขายได้</h4> 
                        <div id="user-product-assignment" style="max-height: 150px; overflow-y: auto; border: 1px solid #BFBFBF; padding: 10px; border-radius: 10px;"></div> 
                    </div> 
                    <div class="form-actions"> <button type="submit" class="success">บันทึกผู้ใช้</button> <button type="button" id="clear-user-form-btn" style="background-color:#6c757d;">เคลียร์ฟอร์ม</button> </div> 
                </form> 
                <div class="table-container"><table id="user-table"> <thead> <tr><th>ชื่อผู้ใช้</th><th>ประเภท</th><th>ร้านค้า</th><th>สินค้าที่ขายได้</th><th>ระยะเวลาที่ขายได้</th><th>จัดการ</th></tr> </thead> <tbody></tbody> </table></div>`;

            document.getElementById('page-data').innerHTML = `<h2>จัดการข้อมูล</h2>
            <div class="data-management-section admin-only data-restore-section"><h3>โหลดข้อมูลจากไฟล์ (Restore)</h3><p style="color: var(--danger-color); font-size:0.9em;"><b>คำเตือน:</b> การโหลดข้อมูลจากไฟล์จะรวมข้อมูลเข้ากับข้อมูลปัจจุบัน ข้อมูลที่ซ้ำกันจะถูกทับด้วยข้อมูลจากไฟล์!</p><input type="file" id="data-file-input" style="display: none;" accept=".json,application/json"><button type="button" id="load-from-file-btn" style="background-color: #E97132;">เลือกไฟล์สำรอง (.json)</button></div>
            <div class="data-management-section admin-only">
                <h3>ตั้งรหัสผ่านสำหรับไฟล์สำรอง</h3>
                <p style="font-size:0.9em;">รหัสผ่านนี้จะใช้เข้ารหัสไฟล์สำรองข้อมูลที่สร้างโดยแอดมินโดยอัตโนมัติ</p>
                <form id="backup-password-form" style="max-width: 400px;">
                    <div class="form-group"><label for="backup-password">รหัสผ่านใหม่ (เว้นว่างเพื่อลบ):</label><input type="password" id="backup-password" placeholder="พิมพ์รหัสผ่านที่นี่"></div>
                    <div class="form-group"><label for="backup-password-confirm">ยืนยันรหัสผ่านใหม่:</label><input type="password" id="backup-password-confirm" placeholder="พิมพ์รหัสผ่านอีกครั้ง"></div>
                    <div class="form-group">
                         <label style="font-weight: normal; cursor: pointer;">
                            <input type="checkbox" id="show-backup-password"> แสดงรหัสผ่าน
                        </label>
                    </div>
                    <div class="form-actions" style="justify-content: center;">
                        <button type="submit" class="success">บันทึกรหัสผ่าน</button>
                    </div>
                </form>
                <p id="password-status" style="font-weight: bold; margin-top: 10px; font-size:0.9em;"></p>
            </div>
            <div class="data-management-section admin-only"><h3>สำรองข้อมูล (Backup)</h3><p style="font-size:0.9em;">สำรองข้อมูลทั้งหมด (ผู้ใช้, สินค้า, ประวัติการขาย) ลงในไฟล์ JSON เพื่อเก็บไว้หรือย้ายไปยังเครื่องอื่น</p><button id="save-to-file-btn" class="success">บันทึกข้อมูลทั้งหมดลงไฟล์</button><button id="save-to-browser-btn" style="background-color: #007bff;">บันทึกชั่วคราวลงในเบราว์เซอร์</button></div>
            <div class="data-management-section admin-only" style="border-color: var(--danger-color);"><h3 style="color: var(--danger-color);">รีเซ็ตข้อมูล (*** การกระทำนี้ไม่สามารถย้อนกลับได้ ***)</h3><p style="font-size:0.9em;">เลือกเพื่อล้างข้อมูลเฉพาะส่วนที่ต้องการ</p><button id="open-reset-modal-btn" class="danger">เปิดหน้าต่างรีเซ็ตข้อมูล</button></div>
            <div class="collapsible-bar admin-only" data-target="admin-stock-report-content" style="background-color: #00B050;"><span>รายงานสต็อกสินค้า</span><span class="arrow">▶</span></div>
            <div id="admin-stock-report-content" class="collapsible-content admin-only">
                <div style="text-align:center; padding: 5px;">
                    <p style="font-size:0.9em;">รายงานนี้จะเปรียบเทียบสต็อกที่คำนวณได้จากประวัติ (นำเข้า - ขาย - ปรับออก) กับสต็อกที่บันทึกไว้ปัจจุบัน</p>
                    <button id="generate-stock-report-btn" class="success">สร้างรายงานสต็อก (ปัจจุบัน)</button>
                    <button id="generate-yesterday-stock-report-btn" style="background-color: #007bff;">รายงานสต็อก (สิ้นวันก่อนหน้า)</button>
                    <button id="recalculate-stock-btn" class="danger">คำนวณสต็อกใหม่ทั้งหมด</button>
                </div>
                <div id="stock-summary-report-container" style="margin-top: 10px;"></div>
            </div>

             <div class="collapsible-bar seller-only" data-target="seller-backup-content"><span>บันทึกข้อมูล (Backup)</span><span class="arrow">▶</span></div>
            <div id="seller-backup-content" class="collapsible-content seller-only"><div style="text-align:center; padding-top: 5px;"><p style="margin-top:0; font-size:0.9em;">สำรองข้อมูลทั้งหมด (ผู้ใช้, สินค้า, ประวัติการขาย) ลงในไฟล์ JSON เพื่อเก็บไว้หรือย้ายไปยังเครื่องอื่น</p><button id="save-to-file-btn-seller" class="success">บันทึกข้อมูลทั้งหมดลงไฟล์</button><button id="save-to-browser-btn-seller" style="background-color: #007bff;">บันทึกข้อมูลชั่วคราวในเบราว์เซอร์</button></div></div>
            
            <div class="collapsible-bar seller-only" data-target="seller-summary-content"><span>รายงานสรุป (สำหรับผู้ใช้ปัจจุบัน)</span><span class="arrow">▶</span></div>
            <div id="seller-summary-content" class="collapsible-content seller-only"><div style="text-align:center;"><div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;"><button id="my-summary-today-btn" style="background-color: var(--warning-color);">สรุปยอดขายวันนี้</button><button id="my-summary-all-btn" style="background-color: #673ab7;">สรุปทั้งหมดของฉัน</button></div><div class="summary-form-inline" style="margin-top: 10px; justify-content: center; flex-direction: column; gap:8px; align-items: stretch;"><label>เลือกวันที่: <input type="date" id="my-summary-date" style="width:100%;"></label><button id="my-summary-by-day-btn" style="background-color: #03a9f4;">สรุปยอดขายวันที่เลือก</button></div><div class="summary-form-inline" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #ddd; justify-content: center; flex-direction: column; gap:8px; align-items: stretch;"><div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;"><label>จากวันที่: <input type="date" id="my-summary-start-date"></label><label>ถึงวันที่: <input type="date" id="my-summary-end-date"></label></div><button id="my-summary-by-range-btn" style="background-color: #ff9800;">สรุปยอดขายตามช่วงวันที่</button></div></div></div>
            <div class="collapsible-bar seller-only" data-target="seller-detailed-report-content" style="background-color: #ED01ED;"><span>แจกแจงรายละเอียดการขาย</span><span class="arrow">▶</span></div>
            <div id="seller-detailed-report-content" class="collapsible-content seller-only">
                <form id="seller-detailed-report-form" class="summary-section" style="display: grid; grid-template-columns: 1fr; gap: 15px; max-width: 800px; margin: auto; padding: 10px;">
                    <div>
                        <h4 style="text-align: left; margin-bottom: 5px; padding-left: 5px; font-size:1em;">1. เลือกประเภทการชำระ</h4>
                        <div id="seller-report-payment-types" style="display: flex; gap: 10px; flex-wrap: wrap; padding: 8px; background-color: #eef5ff; border-radius: 6px; justify-content: center; font-size:0.9em;">
                            <label style="font-weight: normal; cursor: pointer;"><input type="checkbox" value="เงินสด" checked> เงินสด</label>
                            <label style="font-weight: normal; cursor: pointer;"><input type="checkbox" value="เงินโอน" checked> เงินโอน</label>
                            <label style="font-weight: normal; cursor: pointer;"><input type="checkbox" value="เครดิต" checked> เครดิต</label>
                        </div>
                    </div>

                    <div>
                        <h4 style="text-align: left; margin-bottom: 5px; padding-left: 5px; font-size:1em;">2. เลือกช่วงเวลา</h4>
                        <div class="summary-form-inline" style="justify-content: space-around; gap:10px;">
                            <label style="font-weight: normal;">จากวันที่: <input type="date" id="seller-report-start-date" required></label>
                            <label style="font-weight: normal;">ถึงวันที่: <input type="date" id="seller-report-end-date" required></label>
                        </div>
                    </div>

                    <div class="form-actions">
                        <button type="submit" class="success" style="width: 100%; max-width: 300px; padding: 10px; font-size: 1.1em;">3. สร้างรายงาน</button>
                    </div>
                </form>
            </div>
            <div class="collapsible-bar seller-only" data-target="seller-credit-report-content" style="background-color: #d32f2f;"><span>สรุปข้อมูลลูกหนี้ (เครดิต)</span><span class="arrow">▶</span></div>
            <div id="seller-credit-report-content" class="collapsible-content seller-only">
                <form id="seller-credit-report-form" class="summary-section" style="padding: 10px; margin: 0 auto; border: none;">
                    <h4 style="text-align: center; margin-top:0; font-size:1em;">เลือกช่วงเวลาที่ต้องการสรุป</h4>
                    <div class="summary-form-inline" style="justify-content: space-around; gap:10px;">
                        <label style="font-weight: normal;">จากวันที่: <input type="date" id="seller-credit-start-date" required></label>
                        <label style="font-weight: normal;">ถึงวันที่: <input type="date" id="seller-credit-end-date" required></label>
                    </div>
                    <div class="form-actions" style="margin-top: 10px;">
                        <button type="submit" class="danger" style="width: 100%; max-width: 300px; padding: 10px;">สร้างรายงานลูกหนี้</button>
                    </div>
                </form>
            </div>
            <div class="collapsible-bar seller-only" data-target="seller-transfer-report-content" style="background-color: #1976d2;"><span>สรุปข้อมูลเงินโอน</span><span class="arrow">▶</span></div>
            <div id="seller-transfer-report-content" class="collapsible-content seller-only">
                <form id="seller-transfer-report-form" class="summary-section" style="padding: 10px; margin: 0 auto; border: none;">
                    <h4 style="text-align: center; margin-top:0; font-size:1em;">เลือกช่วงเวลาที่ต้องการสรุป</h4>
                    <div class="summary-form-inline" style="justify-content: space-around; gap:10px;">
                        <label style="font-weight: normal;">จากวันที่: <input type="date" id="seller-transfer-start-date" required></label>
                        <label style="font-weight: normal;">ถึงวันที่: <input type="date" id="seller-transfer-end-date" required></label>
                    </div>
                    <div class="form-actions" style="margin-top: 10px;">
                        <button type="submit" style="background-color: #007bff; width: 100%; max-width: 300px; padding: 10px;">สร้างรายงานเงินโอน</button>
                    </div>
                </form>
            </div>
            <div class="collapsible-bar seller-only active" data-target="seller-sales-history-container"><span>ค้นหารายการขาย</span><span class="arrow" style="transform: rotate(90deg);">▶</span></div>
            <div id="seller-sales-history-container" class="collapsible-content seller-only active">
                <form id="seller-sales-filter-form" style="max-width: none; background-color: #eef5ff; padding: 10px; border-radius: 6px;">
                    <div style="grid-column: 1/-1; display:flex; flex-wrap:wrap; gap: 15px; justify-content:center; align-items:center; margin-bottom: 8px;">
                        <label><input type="radio" name="seller-filter-type" value="today" checked> วันนี้</label>
                        <label><input type="radio" name="seller-filter-type" value="by_date"> เลือกวัน</label>
                        <label><input type="radio" name="seller-filter-type" value="by_range"> เลือกช่วง</label>
                    </div>
                    <div id="seller-date-inputs" style="grid-column: 1/-1; display:flex; flex-wrap:wrap; gap: 10px; justify-content:center; align-items:flex-end;">
                        <div id="seller-filter-by-date-div" style="display:none;"><label>เลือกวันที่:<input type="date" id="seller-filter-date"></label></div>
			<div id="seller-filter-by-range-div" style="display:none; display:flex; gap:8px; flex-wrap:wrap; justify-content:center;">
                           <label>จาก:<input type="date" id="seller-filter-start-date"></label>
                           <label>ถึง:<input type="date" id="seller-filter-end-date"></label>
                        </div>
                    </div>
                    <div class="form-actions" style="margin-top: 10px;">
                        <button type="submit" style="background-color:#008CBA; padding: 8px 15px;">แสดงรายการ</button>
                    </div>
                </form>
                <div class="table-container" style="margin-top:10px;"><table id="seller-sales-history-table"><thead><tr><th>วันที่</th><th>เวลา</th><th>รายการสินค้า</th><th>ยอดขาย</th><th>ประเภทชำระ</th><th>จัดการ</th></tr></thead><tbody></tbody></table></div>
            </div>`;
        },

        // --- EVENT LISTENERS ---
        attachEventListeners(){ 
            document.getElementById('login-form').addEventListener('submit', (e) => { e.preventDefault(); this.login(document.getElementById('username').value, document.getElementById('password').value); }); 
            document.getElementById('logout-btn').addEventListener('click', () => this.logout()); 
            
            const mainApp = document.getElementById('main-app');
            mainApp.addEventListener('submit', (e) => { 
                if (e.target.id === 'add-to-cart-form') { e.preventDefault(); this.addToCart(e); }
                if (e.target.id === 'product-form') { e.preventDefault(); this.saveProduct(e); } 
                if (e.target.id === 'store-form') { e.preventDefault(); this.saveStore(e); } 
                if (e.target.id === 'stock-in-form') { e.preventDefault(); this.saveStockIn(e); }
                if (e.target.id === 'stock-out-form') { e.preventDefault(); this.saveStockOut(e); }
                if (e.target.id === 'report-filter-form') { e.preventDefault(); this.renderReport(e); } 
                if (e.target.id === 'user-form') { e.preventDefault(); this.saveUser(e); }
                if (e.target.id === 'seller-sales-filter-form') { e.preventDefault(); this.renderSellerSalesHistoryWithFilter(); }
                if (e.target.id === 'seller-detailed-report-form') { e.preventDefault(); this.runSellerDetailedReport(); }
                if (e.target.id === 'seller-credit-report-form') { e.preventDefault(); this.runSellerCreditSummary(); }
                if (e.target.id === 'seller-transfer-report-form') { e.preventDefault(); this.runSellerTransferSummary(); }
                if (e.target.id === 'backup-password-form') { e.preventDefault(); this.saveBackupPassword(e); }
            }); 
            mainApp.addEventListener('click', (e) => { 
                if (e.target.id === 'process-sale-btn') this.processSale(); 
                if (e.target.classList.contains('remove-from-cart-btn')) this.removeFromCart(e.target.dataset.index); 
                if (e.target.id === 'toggle-special-price-btn') this.toggleSpecialPrice(); 
                if (e.target.classList.contains('edit-sale-btn')) this.editSale(e.target.dataset.id); 
                if (e.target.classList.contains('delete-sale-btn')) { this.deleteSale(e.target.dataset.id); this.renderSalesHistory(); } 
                if (e.target.classList.contains('seller-delete-sale-btn')) {
                    const saleId = e.target.dataset.id;
                    if (confirm('คุณแน่ใจหรือไม่ว่าต้องการลบรายการขายนี้? สต็อกสินค้าจะถูกคืนเข้าระบบ')) {
                        this.deleteSale(saleId);
                        this.renderSellerSalesHistoryWithFilter();
                    }
                }
                if (e.target.id === 'clear-product-form-btn') { document.getElementById('product-form').reset(); document.getElementById('product-id').value = ''; } 
                if (e.target.classList.contains('edit-product-btn')) this.editProduct(e.target.dataset.id); 
                if (e.target.classList.contains('delete-product-btn')) this.deleteProduct(e.target.dataset.id);
                if (e.target.id === 'clear-store-form-btn') { document.getElementById('store-form').reset(); document.getElementById('store-id').value = ''; }
                if (e.target.classList.contains('edit-store-btn')) this.editStore(e.target.dataset.id);
                if (e.target.classList.contains('delete-store-btn')) this.deleteStore(e.target.dataset.id);
                if (e.target.id === 'clear-user-form-btn') this.setupUserForm();
                if (e.target.classList.contains('edit-user-btn')) this.editUser(e.target.dataset.id); 
                if (e.target.classList.contains('delete-user-btn')) this.deleteUser(e.target.dataset.id); 
                
                if (e.target.classList.contains('edit-stock-in-btn')) this.editStockIn(e.target.dataset.id);
                if (e.target.classList.contains('delete-stock-in-btn')) this.deleteStockIn(e.target.dataset.id);
                if (e.target.id === 'clear-stock-in-form-btn') this.clearStockInForm();
                
                if (e.target.classList.contains('edit-stock-out-btn')) this.editStockOut(e.target.dataset.id);
                if (e.target.classList.contains('delete-stock-out-btn')) this.deleteStockOut(e.target.dataset.id);
                if (e.target.id === 'clear-stock-out-form-btn') this.clearStockOutForm();

                // แก้ไข: เปลี่ยนจาก CSV เป็น XLSX
                if (e.target.id === 'export-sales-history-excel-btn') {
                    this.exportSalesHistoryToXlsx();
                }

                const collapsibleBar = e.target.closest('.collapsible-bar');
                if (collapsibleBar) {
                    const targetId = collapsibleBar.dataset.target;
                    const content = document.getElementById(targetId);
                    if (content) {
                        collapsibleBar.classList.toggle('active');
                        content.classList.toggle('active');
                        const arrow = collapsibleBar.querySelector('.arrow');
                        if (arrow) {
                           arrow.style.transform = content.classList.contains('active') ? 'rotate(90deg)' : 'rotate(0deg)';
                        }
                    }
                }
                
                if (e.target.id === 'load-from-file-btn') document.getElementById('data-file-input').click();
                if (e.target.id === 'save-to-file-btn' || e.target.id === 'save-to-file-btn-seller') this.saveBackupToFile(); 
                if (e.target.id === 'save-to-browser-btn' || e.target.id === 'save-to-browser-btn-seller') this.manualSaveToBrowser(); 
                
                if (e.target.id === 'open-reset-modal-btn') this.openResetModal();

                if (e.target.id === 'generate-stock-report-btn') this.renderStockSummaryReport();
                if (e.target.id === 'generate-yesterday-stock-report-btn') this.renderYesterdayStockSummaryReport();
                if (e.target.id === 'recalculate-stock-btn') this.handleRecalculateStock();

                if (e.target.id === 'my-summary-today-btn') this.summarizeMyToday(); 
                if (e.target.id === 'my-summary-all-btn') this.summarizeMyAll(); 
                if (e.target.id === 'my-summary-by-day-btn') this.summarizeMyDay(); 
                if (e.target.id === 'my-summary-by-range-btn') this.summarizeMyRange();

                // New/Refactored Admin Summary Buttons
                if (e.target.id === 'admin-summary-today-btn') this.runAdminSummaryToday();
                if (e.target.id === 'admin-summary-all-btn') this.runAdminSummaryAll();
                if (e.target.id === 'admin-summary-by-day-btn') this.runAdminSummaryByDay();
                if (e.target.id === 'generate-detailed-report-btn') this.runAdminDetailedReport();
                if (e.target.id === 'generate-credit-summary-btn') this.runAdminCreditSummary();
                if (e.target.id === 'generate-transfer-summary-btn') this.runAdminTransferSummary();
                if (e.target.id === 'generate-aggregated-summary-btn') this.runAdminSummaryByCustomRange();

                // Summary output buttons
                if (e.target.classList.contains('btn-display')) App.handleSummaryOutput('display');
                if (e.target.classList.contains('btn-excel')) App.handleSummaryOutput('excel');
                if (e.target.classList.contains('btn-pdf')) App.handleSummaryOutput('pdf');
                if (e.target.classList.contains('btn-cancel')) App.closeSummaryOutputModal();
            }); 
		
            document.body.addEventListener('change', (e) => {
                if (e.target.id === 'show-password-login') {
                    document.getElementById('password').type = e.target.checked ? 'text' : 'password';
                }
                if (e.target.id === 'show-password-user-form') {
                    document.getElementById('user-password').type = e.target.checked ? 'text' : 'password';
                    document.getElementById('user-password-confirm').type = e.target.checked ? 'text' : 'password';
                }
                if (e.target.id === 'show-backup-password') {
                    document.getElementById('backup-password').type = e.target.checked ? 'text' : 'password';
                    document.getElementById('backup-password-confirm').type = e.target.checked ? 'text' : 'password';
                }
            });

	        mainApp.addEventListener('change', (e) => { 
                if(e.target.name === 'payment-method') this.togglePaymentDetailFields(); 
                if (e.target.id === 'user-role') { 
                    const productDiv = document.getElementById('user-product-assignment-container'); 
                    const salesDiv = document.getElementById('user-sales-period-container'); 
                    const storeDiv = document.getElementById('user-store-assignment-container');
                    const commissionDiv = document.getElementById('user-commission-settings-container');
                    const historyDiv = document.getElementById('user-history-view-container');
                    const sellerFields = [productDiv, salesDiv, storeDiv, commissionDiv, historyDiv];

                    if (e.target.value === 'seller') { 
                        sellerFields.forEach(c => c.style.display = 'grid'); 
                        this.renderUserStoreAssignment(document.getElementById('user-store-select')?.value);
                        this.renderUserProductAssignment(); 
                    } else { 
                        sellerFields.forEach(c => c.style.display = 'none');
                    } 
                } 
                if (e.target.id === 'data-file-input') this.promptLoadFromFile(e); 
                if (e.target.id === 'pos-product') this.updateSpecialPriceInfo(); 
                
                if (['report-start-date', 'report-end-date', 'report-seller'].includes(e.target.id)) {
                    this.renderReport(e);
                }

                if (e.target.id === 'reset-products-checkbox') {
                    if (e.target.checked) {
                        document.getElementById('reset-sales-checkbox').checked = true;
                        document.getElementById('reset-stockins-checkbox').checked = true;
                    }
                }
                
                if (e.target.id === 'pos-date' || e.target.id === 'pos-time') {
                    const dateInput = document.getElementById('pos-date');
                    const timeInput = document.getElementById('pos-time');
                    const isBackdating = dateInput.value || timeInput.value;
                    dateInput.classList.toggle('backdating-active', isBackdating);
                    timeInput.classList.toggle('backdating-active', isBackdating);
                }

                 if (e.target.name === 'seller-filter-type') {
                    const byDateDiv = document.getElementById('seller-filter-by-date-div');
                    const byRangeDiv = document.getElementById('seller-filter-by-range-div');
                    switch (e.target.value) {
                        case 'today':
                            byDateDiv.style.display = 'none';
                            byRangeDiv.style.display = 'none';
                            break;
                        case 'by_date':
                            byDateDiv.style.display = 'block';
                            byRangeDiv.style.display = 'none';
                            break;
                        case 'by_range':
                            byDateDiv.style.display = 'none';
                            byRangeDiv.style.display = 'flex';
                            break;
                    }
                }
                
                if (e.target.id === 'stock-in-product') {
                    const productId = e.target.value;
                    const costInput = document.getElementById('stock-in-cost');
                    const priceInput = document.getElementById('stock-in-price');
                    if (productId) {
                        const product = this.data.products.find(p => p.id == productId);
                        if (product) {
                            costInput.value = product.costPrice;
                            priceInput.value = product.sellingPrice;
                        }
                    } else {
                        costInput.value = '';
                        priceInput.value = '';
                    }
                }
            }); 
            
            // เพิ่ม event listener สำหรับปุ่มส่งออก Excel
            const exportExcelBtn = document.getElementById('export-sales-history-excel-btn');
            if (exportExcelBtn) {
                exportExcelBtn.addEventListener('click', () => {
                    this.exportSalesHistoryToXlsx();
                });
            }
            
            document.getElementById('cancel-reset-btn').addEventListener('click', () => this.closeResetModal());
            document.getElementById('confirm-selective-reset-btn').addEventListener('click', () => this.handleSelectiveReset());
        },
    };
    
    window.App = App;
    App.init();
});