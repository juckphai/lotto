// make it installable
if('serviceWorker' in navigator) {
  // --- จุดที่แก้ไข ---
  // แก้ไข path จาก '/service-worker.js' เป็น 'service-worker.js' (เอา / ข้างหน้าออก)
  // เพื่อให้ทำงานบน GitHub Pages ได้ถูกต้อง ซึ่งจะมองหาไฟล์จาก path ปัจจุบัน
  navigator.serviceWorker.register('service-worker.js') 
    .then(reg => console.log('service worker registered', reg))
    .catch(err => console.log('service worker not registered', err));
}

// --- ส่วนที่เหลือของโค้ดคงเดิม ---
function generateRandomLottoNumbers() {
  const numbers = new Set();
  while (numbers.size < 6) {
    numbers.add(Math.floor(Math.random() * 45) + 1);
  }
  return Array.from(numbers).sort((a, b) => a - b);
}

function displayLottoNumbers(numbers) {
  const lottoNumbersDiv = document.getElementById('lotto-numbers');
  lottoNumbersDiv.innerHTML = ''; // Clear previous numbers
  numbers.forEach(number => {
    const span = document.createElement('span');
    span.className = 'lotto-number';
    span.textContent = number;
    lottoNumbersDiv.appendChild(span);
  });
}

document.getElementById('generate-btn').addEventListener('click', () => {
  const lottoNumbers = generateRandomLottoNumbers();
  displayLottoNumbers(lottoNumbers);
});