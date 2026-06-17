import https from 'https';

const token = "EAAbO8XUAZCEMBRvxS3NvPZC7LwPleFZCIwFZCi9k3hhgziTZA3uhhDT243zoPA3ATg8bW4PAoMwZBjsykcy7ofmaECSABgJvzXojRudgkB5eHE6YL5ZAkQg6pwrBw8vvm71RSZAXr5oEUBOJcvM3e0FsESHFOlaKkMhZBtMfDdNcc4QyxR7PFFgIwiw80IHcy7QZDZD";
const phoneId = "1111232138747481";
const adminPhone = "919875667430";

const body = JSON.stringify({
  messaging_product: "whatsapp",
  to: adminPhone,
  type: "text",
  text: { body: "🧪 Test admin notification from YaatraExpress bot" }
});

const req = https.request({
  hostname: 'graph.facebook.com',
  path: `/v20.0/${phoneId}/messages`,
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, (res) => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', d);
  });
});
req.on('error', e => console.error(e.message));
req.write(body); req.end();
