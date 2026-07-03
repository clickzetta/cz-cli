/**
 * Object storage client ported from clickzetta/connector/v0/object_storage_client.py.
 * Provides ObjectStorageType enum and ObjectStorageClient class.
 *
 * NOTE: Actual cloud SDK integrations (OSS, COS, S3, GCS, TOS) are excluded
 * from this port. The class provides the interface and type definitions;
 * concrete implementations should use the respective Node.js SDKs.
 */

export enum ObjectStorageType {
  OSS = 0,
  COS = 1,
  S3 = 2,
  GCS = 3,
  TOS = 4,
}

export interface ObjectStorageConfig {
  type: ObjectStorageType
  akId: string
  akSecret: string
  token: string
  endpoint: string
  bucket?: string
}

/**
 * ObjectStorageClient provides a unified interface for accessing
 * different cloud object storage services.
 *
 * In the Python SDK, this initializes provider-specific clients (oss2, boto3, etc.).
 * In the TS SDK, callers should inject the appropriate client or use
 * the getStream method with a provider-specific implementation.
 */
export class ObjectStorageClient {
  readonly type: ObjectStorageType
  readonly akId: string
  readonly akSecret: string
  readonly token: string
  readonly endpoint: string
  readonly bucket?: string

  constructor(config: ObjectStorageConfig) {
    this.type = config.type
    this.akId = config.akId
    this.akSecret = config.akSecret
    this.token = config.token
    this.endpoint = config.endpoint
    this.bucket = config.bucket
  }

  /**
   * Get a stream/buffer from the object storage.
   * This is a placeholder — actual implementation depends on the cloud provider SDK.
   *
   * @param bucketName - The bucket to read from
   * @param objectName - The object key/path
   * @returns Buffer containing the object data
   */
  async getStream(bucketName: string, objectName: string): Promise<Buffer> {
    switch (this.type) {
      case ObjectStorageType.OSS:
        // Would use ali-oss SDK
        throw new Error("OSS client not implemented in TS SDK — use ali-oss directly")
      case ObjectStorageType.COS:
        // Would use cos-nodejs-sdk-v5
        throw new Error("COS client not implemented in TS SDK — use cos-nodejs-sdk-v5 directly")
      case ObjectStorageType.S3:
        // Would use @aws-sdk/client-s3
        throw new Error("S3 client not implemented in TS SDK — use @aws-sdk/client-s3 directly")
      case ObjectStorageType.GCS:
        // Would use @google-cloud/storage
        throw new Error("GCS client not implemented in TS SDK — use @google-cloud/storage directly")
      case ObjectStorageType.TOS:
        // Would use @volcengine/tos-sdk
        throw new Error("TOS client not implemented in TS SDK — use @volcengine/tos-sdk directly")
      default:
        throw new Error(`Unsupported object storage type: ${this.type}`)
    }
  }
}
