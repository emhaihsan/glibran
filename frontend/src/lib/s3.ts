import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "mock_key",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "mock_secret",
  },
});

export async function generatePresignedUrl(key: string, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME || "glibran-storage",
    Key: key,
    ContentType: contentType,
  });

  // URL valid for 5 minutes
  const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });
  return url;
}
