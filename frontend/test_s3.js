const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
require("dotenv").config();

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "mock_key",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "mock_secret",
  },
});

async function run() {
  try {
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME || "glibran-storage",
      Key: "test.mp4",
      ContentType: "video/mp4",
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });
    console.log("SUCCESS:", url);
  } catch(e) {
    console.log("ERROR:", e);
  }
}
run();
