const OCR = require('@alicloud/ocr20191230');
const OpenApi = require('@alicloud/openapi-client');
const Util = require('@alicloud/tea-util');
const TableStore = require('tablestore');

// === CONFIG ===
const REGION = 'ap-southeast-1'; // ← Change to your region
const INSTANCE_NAME = 'receipt-sync'; // ← Your Tablestore instance name
const TABLE_NAME = 'receipts';

// Initialize OCR Client
const config = new OpenApi.Config({
  accessKeyId: process.env.ACCESS_KEY_ID,
  accessKeySecret: process.env.ACCESS_KEY_SECRET,
  endpoint: `ocr.${REGION}.aliyuncs.com`,
  regionId: REGION
});

const ocrClient = new OCR.default(config);

// Initialize Tablestore
const client = new TableStore.Client({
  accessKeyId: process.env.ACCESS_KEY_ID,
  secretAccessKey: process.env.ACCESS_KEY_SECRET,
  endpoint: `https://${INSTANCE_NAME}.${REGION}.ots.aliyuncs.com`,
  instancename: INSTANCE_NAME
});

// Helper: Save to Tablestore
function saveToTablestore(userId, receiptData) {
  const params = {
    tableName: TABLE_NAME,
    putRequest: {
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
      primaryKey: [
        { 'user_id': userId },
        { 'timestamp': receiptData.timestamp }
      ],
      attributeColumns: [
        { 'shop_name': receiptData.shopName },
        { 'amount': receiptData.amount },
        { 'payment_method': receiptData.paymentMethod }
      ]
    }
  };

  return new Promise((resolve, reject) => {
    client.putRow(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

// Helper: Sync from Tablestore
async function syncFromCloud(userId) {
  const params = {
    tableName: TABLE_NAME,
    direction: TableStore.Direction.BACKWARD,
    maxVersions: 1,
    limit: 100,
    inclusiveStartPrimaryKey: [{ 'user_id': userId }, { 'timestamp': TableStore.INF_MAX }],
    exclusiveEndPrimaryKey: [{ 'user_id': userId }, { 'timestamp': TableStore.INF_MIN }]
  };

  return new Promise((resolve, reject) => {
    client.getRange(params, (err, data) => {
      if (err) reject(err);
      else {
        const receipts = data.rows.map(row => {
          const attrs = row.attributeColumns.reduce((acc, col) => {
            acc[col[0]] = col[1];
            return acc;
          }, {});
          return {
            shopName: attrs.shop_name || 'N/A',
            amount: attrs.amount || 'N/A',
            paymentMethod: attrs.payment_method || 'N/A',
            timestamp: row.primaryKey[1].timestamp
          };
        });
        resolve(receipts);
      }
    });
  });
}

// === HTTP HANDLER ===
module.exports.handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'POST') {
      // === SCAN RECEIPT ===
      const { image, userId } = req.body;

      if (!image || !userId) {
        return res.status(400).json({ error: 'image and userId required' });
      }

      // 1. Call OCR
      const recognizeReceiptRequest = new OCR.RecognizeReceiptRequest({
        image: image  // ← Changed from imageURL to image
      });

      const ocrResponse = await ocrClient.recognizeReceipt(recognizeReceiptRequest);
      const data = ocrResponse.body.data || {};

      const receipt = {
        shopName: data.shopName || 'N/A',
        amount: data.amount || 'N/A',
        paymentMethod: data.paymentMethod || 'N/A',
        timestamp: Date.now()
      };

      // 2. Save to Tablestore
      await saveToTablestore(userId, receipt);

      // 3. Return result
      res.json({
        shopName: receipt.shopName,
        amount: receipt.amount,
        paymentMethod: receipt.paymentMethod
      });

    } else if (req.method === 'GET' && req.url.includes('/sync')) {
      // === SYNC FROM CLOUD ===
      const url = new URL(req.url, `https://${req.headers.host}`);
      const userId = url.searchParams.get('userId');

      if (!userId) return res.status(400).json({ error: 'userId required' });

      const receipts = await syncFromCloud(userId);
      res.json(receipts);

    } else {
      res.status(404).json({ error: 'Not found' });
    }

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
};