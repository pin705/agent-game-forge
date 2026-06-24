import type { ProjectFile, Storage } from "./types";

/**
 * Cloudflare R2 storage (S3-compatible). Used in prod when all of
 * R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET are set.
 *
 * No network at import time: the S3 client is created lazily on first use and
 * the SDK is imported dynamically so a missing dependency never breaks the
 * build of the local-dev path.
 *
 * Files live under `projects/<projectId>/<path>` (see SAAS_ARCHITECTURE.md §4).
 */
export class R2Storage implements Storage {
  private clientPromise: Promise<import("@aws-sdk/client-s3").S3Client> | null = null;
  private readonly bucket = process.env.R2_BUCKET!;

  private prefix(projectId: string): string {
    return `projects/${projectId}/`;
  }

  private async client() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { S3Client } = await import("@aws-sdk/client-s3");
        return new S3Client({
          region: "auto",
          endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID!,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
          },
        });
      })();
    }
    return this.clientPromise;
  }

  async listProjectFiles(projectId: string): Promise<string[]> {
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    const prefix = this.prefix(projectId);
    const out: string[] = [];
    let token: string | undefined;
    do {
      const res = await client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key) out.push(obj.Key.slice(prefix.length));
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async readProjectFile(projectId: string, p: string): Promise<string | null> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    try {
      const res = await client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.prefix(projectId) + p }),
      );
      return (await res.Body?.transformToString("utf-8")) ?? null;
    } catch {
      return null;
    }
  }

  async writeProjectFile(projectId: string, p: string, content: string): Promise<void> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.prefix(projectId) + p,
        Body: content,
        ContentType: "text/plain; charset=utf-8",
      }),
    );
  }

  async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    const paths = await this.listProjectFiles(projectId);
    const files = await Promise.all(
      paths.map(async (p) => ({ path: p, content: (await this.readProjectFile(projectId, p)) ?? "" })),
    );
    return files;
  }

  async putProjectFiles(projectId: string, files: ProjectFile[]): Promise<void> {
    for (const f of files) await this.writeProjectFile(projectId, f.path, f.content);
  }
}
