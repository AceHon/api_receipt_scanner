const ALY = require('aliyun-sdk');

// Initialize OCR client
const ocr = new ALY.OCR({
  accessKeyId: process.env.ACCESS_KEY_ID,
  secretAccessKey: process.env.ACCESS_KEY_SECRET,
  endpoint: 'ocr.ap-southeast-1.aliyuncs.com', // Change region if needed
  apiVersion: '2019-12-30'
});

module.exports.handler = async (req, res) => {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Image base64 required' });
    }

    const result = await ocr.recognizeReceipt({
      ImageBase64: image
    }).promise();

    const data = result.Data || {};
    res.json({
      shopName: data.ShopName || 'N/A',
      amount: data.Amount || 'N/A',
      paymentMethod: data.PaymentMethod || 'N/A'
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};