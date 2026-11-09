/// <reference types="multer" />
import {
  CompleteMultipartUploadCommandOutput,
  DeleteObjectCommand,
  DeleteObjectCommandOutput,
  DeleteObjectsCommand,
  DeleteObjectsCommandOutput,
  GetObjectCommand,
  GetObjectCommandOutput,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  ObjectCannedACL,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  APP_NAME,
  AWS_ACCESS_KEY_ID,
  AWS_BUCKET_NAME,
  AWS_ExPIRES_IN,
  AWS_REGION,
  AWS_SECRET_ACCESS_KEY,
} from "../../config/config.service";
import { randomUUID } from "node:crypto";
import { BadRequestException } from "../exceptions";
import { StorageApproachEnum, UploadApproachEnum } from "../enums";
import { createReadStream } from "node:fs";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export class S3Service {
  private client: S3Client;
  constructor() {
    this.client = new S3Client({
      region: AWS_REGION,
      credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
      },
    });
  }

  async uploadAsset({
    storageApproach = StorageApproachEnum.MEMORY,
    bucket = AWS_BUCKET_NAME,
    path = "general",
    file,
    ACL = ObjectCannedACL.private,
    contentType,
  }: {
    storageApproach?: StorageApproachEnum;
    bucket?: string;
    path?: string;
    file: Express.Multer.File;
    ACL?: ObjectCannedACL;
    contentType?: string | undefined;
  }): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: `${APP_NAME}/${path}/${randomUUID()}__${file.originalname}`,
      ACL,
      Body:
        storageApproach === StorageApproachEnum.MEMORY
          ? file.buffer
          : createReadStream(file.path),
      ContentType: file.mimetype || contentType,
    });

    if (!command.input.Key) {
      throw new BadRequestException("failed to upload asset");
    }

    await this.client.send(command);

    return command.input.Key;
  }

  async uploadLargeAsset({
    storageApproach = StorageApproachEnum.DISK,
    bucket = AWS_BUCKET_NAME,
    path = "general",
    file,
    ACL = ObjectCannedACL.private,
    contentType,
    partSize = 5,
  }: {
    storageApproach?: StorageApproachEnum;
    bucket?: string;
    path?: string;
    file: Express.Multer.File;
    ACL?: ObjectCannedACL;
    contentType?: string | undefined;
    partSize?: number;
  }): Promise<CompleteMultipartUploadCommandOutput> {
    const uploadFile = new Upload({
      client: this.client,
      params: {
        Bucket: bucket,
        Key: `${APP_NAME}/${path}/${randomUUID()}__${file.originalname}`,
        ACL,
        Body:
          storageApproach === StorageApproachEnum.MEMORY
            ? file.buffer
            : createReadStream(file.path),
        ContentType: file.mimetype || contentType,
      },
      partSize: 1024 * 1024 * partSize, // 5 MB
      leavePartsOnError: false,
    });

    uploadFile.on("httpUploadProgress", (progress) => {
      console.log(
        `file upload progress: ${((progress.loaded as number) / (progress.total as number)) * 100}%`,
      );
      console.log(
        `Uploaded ${progress.loaded} bytes of ${progress.total} bytes.`,
      );
    });

    return await uploadFile.done();
  }

  async uploadMultipleAssets({
    uploadApproach = UploadApproachEnum.SMALL,
    storageApproach = StorageApproachEnum.MEMORY,
    bucket = AWS_BUCKET_NAME,
    path = "general",
    files,
    ACL = ObjectCannedACL.private,
    contentType,
  }: {
    uploadApproach?: UploadApproachEnum;
    storageApproach?: StorageApproachEnum;
    bucket?: string;
    path?: string;
    files: Express.Multer.File[];
    ACL?: ObjectCannedACL;
    contentType?: string;
  }): Promise<string[]> {
    let filesUrls = [] as string[];

    if (uploadApproach === UploadApproachEnum.LARGE) {
      const data = await Promise.all(
        files.map((file) =>
          this.uploadLargeAsset({
            storageApproach,
            bucket,
            path,
            file,
            ACL,
            contentType,
          }),
        ),
      );

      filesUrls = data.map((data) => data.Key as string);
    } else {
      filesUrls = await Promise.all(
        files.map((file) =>
          this.uploadAsset({
            storageApproach,
            bucket,
            path,
            file,
            ACL,
            contentType,
          }),
        ),
      );
    }

    return filesUrls;
  }

  async createPreSignedUrl({
    bucket = AWS_BUCKET_NAME,
    path = "general",
    contentType,
    originalname,
  }: {
    bucket?: string;
    path?: string;
    contentType?: string;
    originalname: string;
  }): Promise<{ url: string; key: string }> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: `${APP_NAME}/${path}/${randomUUID()}__${originalname}`,
      ContentType: contentType,
    });

    if (!command.input.Key) {
      throw new BadRequestException("failed to upload asset");
    }

    const url = await getSignedUrl(this.client, command, {
      expiresIn: AWS_ExPIRES_IN,
    });

    return { url, key: command.input.Key as string };
  }

  async getAsset({
    bucket = AWS_BUCKET_NAME,
    key,
  }: {
    bucket?: string;
    key: string;
  }): Promise<GetObjectCommandOutput> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    return await this.client.send(command);
  }

  async getPreSignedUrl({
    bucket = AWS_BUCKET_NAME,
    key,
    expiresIn = AWS_ExPIRES_IN,
    fileName,
    download,
  }: {
    bucket?: string;
    key: string;
    expiresIn?: number;
    fileName?: string;
    download?: string;
  }): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition:
        download === "true"
          ? `attachment; filename="${fileName || key.split("/").pop()}"`
          : undefined,
    });

    return await getSignedUrl(this.client, command, { expiresIn });
  }

  async deleteAsset({
    bucket = AWS_BUCKET_NAME,
    key,
  }: {
    bucket?: string;
    key: string;
  }): Promise<DeleteObjectCommandOutput> {
    if (!key) {
      return { $metadata: {} } as DeleteObjectCommandOutput;
    }

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    return await this.client.send(command);
  }

  async deleteMultipleAssets({
    bucket = AWS_BUCKET_NAME,
    keys,
  }: {
    bucket?: string;
    keys: string[];
  }): Promise<DeleteObjectsCommandOutput> {
    if (!keys?.length) {
      return { $metadata: {}, Deleted: [] } as DeleteObjectsCommandOutput;
    }

    const command = new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: keys.map((Key) => ({ Key })),
        Quiet: false,
      },
    });

    return await this.client.send(command);
  }

  async listFolderDir({
    bucket = AWS_BUCKET_NAME,
    prefix,
  }: {
    bucket?: string;
    prefix: string;
  }): Promise<ListObjectsV2CommandOutput> {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `${APP_NAME}/${prefix}`,
    });

    return await this.client.send(command);
  }

  async deleteFolderByPrefix({
    bucket = AWS_BUCKET_NAME,
    prefix,
  }: {
    bucket?: string;
    prefix: string;
  }): Promise<DeleteObjectsCommandOutput> {
    const result = await this.listFolderDir({ bucket, prefix });
    const keys = (result.Contents?.map((content) => content.Key).filter(Boolean) ?? []) as string[];
    if (!keys.length) {
      return { $metadata: {}, Deleted: [] } as DeleteObjectsCommandOutput;
    }
    return await this.deleteMultipleAssets({ bucket, keys });
  }


}

export const s3Service = new S3Service();
