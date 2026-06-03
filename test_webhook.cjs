const axios = require('axios');
axios.post('http://localhost:8002/api/sessions/93e40c89-8ca7-4a45-95ca-8489790426b9/webhooks', {
  url: 'http://middleware:3001/webhook/inbound',
  events: ['message.received', 'session.status', 'session.authenticated'],
  retryCount: 3
}, {
  headers: { 'X-API-Key': 'dev-admin-key' }
}).then(res => console.log(res.data)).catch(err => console.error(err.response ? err.response.data : err.message));
