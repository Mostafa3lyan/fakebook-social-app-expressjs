import {
  HydratedDocument,
  Model,
  CreateOptions,
  UpdateWithAggregationPipeline,
  mongo,
  PopulateOptions,
} from "mongoose";
import type {
  QueryFilter,
  QueryOptions,
  ProjectionType,
  UpdateQuery,
  FlattenMaps,
  AggregateOptions,
} from "mongoose";
import { BadRequestException } from "../../common/exceptions";
import { PipelineStage } from "mongoose";
import { MongooseBulkWriteOptions } from "mongoose";
import { IPagination } from "../../common/interfaces";

type UpdateQueryOptions<T> = NonNullable<Parameters<Model<T>["updateOne"]>[2]>;
type DeleteQueryOptions<T> = NonNullable<Parameters<Model<T>["deleteOne"]>[1]>;

export abstract class DatabaseRepository<TRawDoc> {
  constructor(protected readonly model: Model<TRawDoc>) { }

  /**
   * Automatically excludes __v from query results unless explicitly requested.
   */
  protected resolveProjection(projection?: ProjectionType<TRawDoc>): ProjectionType<TRawDoc> {
    if (!projection) return { __v: 0 } as ProjectionType<TRawDoc>;

    if (typeof projection === "string") {
      if (projection.includes("__v")) return projection;
      const tokens = projection.trim().split(/\s+/).filter(Boolean);
      const isExclusion = tokens.length > 0 && tokens.every((t) => t.startsWith("-"));
      return isExclusion ? (`${projection} -__v` as ProjectionType<TRawDoc>) : projection;
    }

    if (Array.isArray(projection)) {
      if (projection.includes("__v") || projection.includes("-__v")) return projection;
      const isExclusion =
        projection.length > 0 && projection.every((t) => typeof t === "string" && t.startsWith("-"));
      return isExclusion ? ([...projection, "-__v"] as ProjectionType<TRawDoc>) : projection;
    }

    if (typeof projection === "object" && !Array.isArray(projection)) {
      if ("__v" in projection) return projection;
      const isExclusion = Object.values(projection).every((v) => v === 0 || v === false);
      if (isExclusion) {
        return { ...projection, __v: 0 } as ProjectionType<TRawDoc>;
      }
    }

    return projection;
  }

  /**
   * Automatically increments __v on update operations.
   */
  protected resolveUpdate(
    update: UpdateQuery<TRawDoc> | UpdateWithAggregationPipeline,
  ): UpdateQuery<TRawDoc> | UpdateWithAggregationPipeline {
    if (!update || Array.isArray(update)) return update;
    const u = update as UpdateQuery<TRawDoc>;

    // If update explicitly handles __v in $inc or $set, don't overwrite it
    if ((u.$inc && "__v" in (u.$inc as Record<string, any>)) || (u.$set && "__v" in (u.$set as Record<string, any>))) {
      return u;
    }

    return {
      ...u,
      $inc: { ...(u.$inc as Record<string, any>), __v: 1 },
    } as UpdateQuery<TRawDoc>;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── Create ────────────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Overload 1 — single document.
   * Pass a single `data` object → returns one `HydratedDocument`.
   * Accepts optional `CreateOptions` (e.g. `{ session }` for transactions).
   *
   * Overload 2 — multiple documents.
   * Pass an array of `data` objects → returns `HydratedDocument[]`.
   * Accepts optional `CreateOptions`
   *
   * Internally always uses the array form of `model.create()` so Mongoose
   * runs schema validators and middleware on every document consistently.
   */
  async create(args: {
    data: Partial<TRawDoc>;
    options?: CreateOptions;
  }): Promise<HydratedDocument<TRawDoc>>;

  async create(args: {
    data: Partial<TRawDoc>[];
    options?: CreateOptions;
  }): Promise<HydratedDocument<TRawDoc>[]>;

  async create({
    data,
    options,
  }: {
    data: Partial<TRawDoc> | Partial<TRawDoc>[];
    options?: CreateOptions;
  }): Promise<HydratedDocument<TRawDoc> | HydratedDocument<TRawDoc>[]> {
    if (Array.isArray(data)) {
      return this.model.create(data as any, options);
    }
    const [doc] = await this.model.create([data] as any, options);
    if (!doc) throw new BadRequestException("Failed to create document");
    return doc;
  }

  /**
   * Explicit single-document creation.
   * Prefer this over `create` when you know you're inserting one document —
   * the return type is always `HydratedDocument<TRawDoc>`, no union.
   *
   * @param data    - Fields to insert.
   * @param options - CreateOptions, e.g. `{ session }` for transactions.
   *
   * @throws BadRequestException if Mongoose returns an empty result.
   */
  async createOne({
    data,
    options,
  }: {
    data: Partial<TRawDoc>;
    options?: CreateOptions;
  }): Promise<HydratedDocument<TRawDoc>> {
    const [doc] = await this.model.create([data] as any, {
      ...options,
    });
    if (!doc) throw new BadRequestException("Failed to create document");
    return doc;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── Read ──────────────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Find a document by its `_id`.
   *
   * Defaults to `lean: true` — returns a plain JS object (`FlattenMaps<TRawDoc>`)
   * unless you explicitly pass `{ lean: false }`.
   *
   * Overload 1 — default (no `options.lean`, or `lean: true`)
   * Returns a plain JS object. Faster, no Mongoose overhead. Use when you only
   * need to read data (e.g. API responses).
   *
   * Overload 2 — `lean: false`
   * Returns a full `HydratedDocument` with Mongoose methods (`save`, virtuals,
   * middleware). Use when you need to mutate and save the document.
   *
   * @param id         - The document `_id` as a string.
   * @param projection - Fields to include/exclude, e.g. `{ password: 0 }`.
   * @param populate   - Relation(s) to populate, e.g. `"role"` or `[{ path: "role" }]`.
   * @param options    - Additional QueryOptions. Pass `{ lean: false }` to get a hydrated document.
   */
  async findById({
    id,
    projection,
    populate,
    options,
  }: {
    id: string;
    projection?: ProjectionType<TRawDoc>;
    populate?: string | PopulateOptions | PopulateOptions[];
    options?: QueryOptions<TRawDoc> & { lean?: true };
  }): Promise<FlattenMaps<TRawDoc> | null>;

  async findById({
    id,
    projection,
    populate,
    options,
  }: {
    id: string;
    projection?: ProjectionType<TRawDoc>;
    populate?: string | PopulateOptions | PopulateOptions[];
    options: QueryOptions<TRawDoc> & { lean: false };
  }): Promise<HydratedDocument<TRawDoc> | null>;

  async findById({
    id,
    projection,
    populate,
    options,
  }: {
    id: string;
    projection?: ProjectionType<TRawDoc>;
    populate?: string | PopulateOptions | PopulateOptions[];
    options?: QueryOptions<TRawDoc>;
  }): Promise<any> {
    const resolvedOptions = { lean: true, ...options };
    let query = this.model.findById(id, this.resolveProjection(projection), resolvedOptions);
    if (populate) query = query.populate(populate as any);
    return query.exec();
  }

  /**
   * Find the first document matching the filter.
   *
   * Defaults to `lean: true` — returns a plain JS object unless you
   * explicitly pass `{ lean: false }`.
   *
   * Overload 1 — default (no `options.lean`, or `lean: true`)
   * Returns a plain JS object. Skips Mongoose document overhead.
   * Best for read-only use cases (transformations, API serialization).
   *
   * Overload 2 — `lean: false`
   * Returns a `HydratedDocument`. Use when you need `.save()` or virtuals.
   *
   * @param filter     - MongoDB query filter, e.g. `{ email: "x@y.com" }`.
   * @param projection - Fields to include/exclude, e.g. `{ password: 0 }`.
   * @param populate   - Relation(s) to populate.
   * @param options    - Additional QueryOptions. Pass `{ lean: false }` to get a hydrated document.
   */
  async findOne({
    filter,
    projection,
    populate,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    projection?: ProjectionType<TRawDoc>;
    populate?: string | PopulateOptions | PopulateOptions[];
    options?: QueryOptions<TRawDoc> & { lean?: true };
  }): Promise<FlattenMaps<TRawDoc> | null>;

  async findOne({
    filter,
    projection,
    populate,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    projection?: ProjectionType<TRawDoc>;
    populate?: string | PopulateOptions | PopulateOptions[];
    options: QueryOptions<TRawDoc> & { lean: false };
  }): Promise<HydratedDocument<TRawDoc> | null>;

  async findOne({
    filter,
    projection,
    populate,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    projection?: ProjectionType<TRawDoc>;
    populate?: string | PopulateOptions | PopulateOptions[];
    options?: QueryOptions<TRawDoc>;
  }): Promise<any> {
    const resolvedOptions = { lean: true, ...options };
    let query = this.model.findOne(filter, this.resolveProjection(projection), resolvedOptions);
    if (populate) query = query.populate(populate as any);
    return query.exec();
  }

  /**
   * Find all documents matching the filter.
   *
   * Defaults to `lean: true` — returns plain JS objects unless you
   * explicitly pass `{ lean: false }`.
   *
   * Overload 1 — default (no `options.lean`, or `lean: true`)
   * Returns plain JS objects. Much faster for large result sets since
   * Mongoose skips document instantiation and middleware.
   *
   * Overload 2 — `lean: false`
   * Returns `HydratedDocument[]`. Use when you need Mongoose methods on results.
   *
   * @param filter     - MongoDB query filter.
   * @param projection - Fields to include/exclude.
   * @param populate   - Relation(s) to populate.
   * @param sort       - Sort order, e.g. `{ createdAt: -1 }`.
   * @param limit      - Maximum number of documents to return.
   * @param skip       - Number of documents to skip (use with `limit` for pagination).
   * @param options    - Additional QueryOptions. Pass `{ lean: false }` to get hydrated documents.
   */
  async find({
    filter,
    projection,
    populate,
    sort,
    limit,
    skip,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    projection?: ProjectionType<TRawDoc>;
    populate?: string | PopulateOptions | PopulateOptions[];
    sort?: Record<string, 1 | -1>;
    limit?: number;
    skip?: number;
    options?: QueryOptions<TRawDoc> & { lean?: true };
  }): Promise<FlattenMaps<TRawDoc>[]>;

  async find({
    filter,
    projection,
    populate,
    sort,
    limit,
    skip,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    projection?: ProjectionType<TRawDoc>;
    populate?: string | PopulateOptions | PopulateOptions[];
    sort?: Record<string, 1 | -1>;
    limit?: number;
    skip?: number;
    options: QueryOptions<TRawDoc> & { lean: false };
  }): Promise<HydratedDocument<TRawDoc>[]>;

  async find({
    filter,
    projection,
    populate,
    sort,
    limit,
    skip,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    projection?: ProjectionType<TRawDoc>;
    populate?: string | PopulateOptions | PopulateOptions[];
    sort?: Record<string, 1 | -1>;
    limit?: number;
    skip?: number;
    options?: QueryOptions<TRawDoc>;
  }): Promise<any> {
    const resolvedOptions = { lean: true, ...options };
    let query = this.model.find(filter, this.resolveProjection(projection), resolvedOptions);
    if (populate) query = query.populate(populate as any);
    if (sort) query = query.sort(sort);
    if (limit !== undefined) query = query.limit(limit);
    if (skip !== undefined) query = query.skip(skip);
    return query.exec();
  }

  /**
    * Paginate documents matching the filter.
    * Runs `find` and `countDocuments` concurrently and returns both the page
    * of results and pagination metadata.
    *
    * Pass no `page` to skip pagination entirely — every matching document is
    * returned in `data` (still respecting `sort`), and only `data`/`total`
    * are populated; `page`, `limit`, `totalPages`, `hasNextPage` and
    * `hasPrevPage` come back `undefined`. Useful for internal/admin calls
    * that want the full list without inventing a fake page size.
    *
    * Defaults to `lean: true` — returns plain JS objects unless you
    * explicitly pass `{ lean: false }` to get hydrated Mongoose documents.
    *
    * Overload 1 — default (no `options.lean`, or `lean: true`)
    * Returns plain JS objects in `data`.
    *
    * Overload 2 — `lean: false`
    * Returns `HydratedDocument[]` in `data`. Use when you need `.save()` or virtuals.
    *
    * @param filter     - MongoDB query filter.
    * @param projection - Fields to include/exclude.
    * @param populate   - Relation(s) to populate.
    * @param sort       - Sort order, e.g. `{ createdAt: -1 }`.
    * @param page       - 1-indexed page number. Omit to return all documents unpaginated.
    * @param limit      - Documents per page. Defaults to `10` when `page` is given.
    * @param options    - Additional QueryOptions. Pass `{ lean: false }` to get hydrated documents.
    */
  async paginate({
    filter,
    projection,
    populate,
    sort,
    page,
    limit,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    projection?: ProjectionType<TRawDoc>;
    populate?: string | PopulateOptions | PopulateOptions[];
    sort?: Record<string, 1 | -1>;
    page?: number | undefined;
    limit?: number | undefined;
    options?: QueryOptions<TRawDoc> & { lean?: true };
  }): Promise<IPagination<FlattenMaps<TRawDoc>>>;

  async paginate({
    filter,
    projection,
    populate,
    sort,
    page,
    limit,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    projection?: ProjectionType<TRawDoc>;
    populate?: string | PopulateOptions | PopulateOptions[];
    sort?: Record<string, 1 | -1>;
    page?: number | undefined;
    limit?: number | undefined;
    options: QueryOptions<TRawDoc> & { lean: false };
  }): Promise<IPagination<HydratedDocument<TRawDoc>>>;

  async paginate({
    filter,
    projection,
    populate,
    sort,
    page,
    limit,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    projection?: ProjectionType<TRawDoc>;
    populate?: string | PopulateOptions | PopulateOptions[];
    sort?: Record<string, 1 | -1>;
    page?: number | undefined;
    limit?: number | undefined;
    options?: QueryOptions<TRawDoc>;
  }): Promise<any> {
    const resolvedOptions = { lean: true, ...options };

    const isPaginated = page !== undefined;
    const safePage = isPaginated ? Math.max(1, page) : undefined;
    const safeLimit = isPaginated ? Math.min(50, Math.max(1, limit ?? 10)) : undefined;
    const skip = isPaginated ? (safePage! - 1) * safeLimit! : undefined;

    let query = this.model.find(filter, this.resolveProjection(projection), resolvedOptions);
    if (populate) query = query.populate(populate as any);
    if (sort) query = query.sort(sort);
    if (isPaginated) query = query.skip(skip!).limit(safeLimit!);

    const [data, total] = await Promise.all([
      query.exec(),
      this.model.countDocuments(filter, resolvedOptions as any),
    ]);

    if (!isPaginated) {
      return { data, total };
    }

    const totalPages = Math.ceil(total / safeLimit!) || 0;

    return {
      data,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages,
      hasNextPage: safePage! < totalPages,
      hasPrevPage: safePage! > 1,
    };
  }

  /**
   * Check whether a document matching the filter exists.
   * More efficient than `findOne` — only fetches `_id`, no full document load.
   *
   * @param filter  - MongoDB query filter.
   * @param options - Additional QueryOptions, e.g. `{ session }`.
   * @returns `{ _id }` if found, `null` otherwise.
   */
  async exists({
    filter,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    options?: QueryOptions<TRawDoc>;
  }): Promise<Pick<mongo.Document, "_id"> | null> {
    const query = this.model.exists(filter);
    if (options) query.setOptions(options as any);
    return query;
  }

  /**
   * Count documents matching the filter.
   * Uses `countDocuments` which respects the filter (unlike `estimatedDocumentCount`).
   *
   * @param filter  - MongoDB query filter.
   * @param options - Additional QueryOptions, e.g. `{ session }`.
   */
  async countDocuments({
    filter,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    options?: QueryOptions<TRawDoc>;
  }): Promise<number> {
    return this.model.countDocuments(filter, options as any);
  }

  /**
   * Run an aggregation pipeline against the collection.
   * Always returns plain objects — Mongoose never hydrates aggregation output.
   *
   * @param pipeline - Aggregation pipeline stages.
   * @param options  - Aggregate options, e.g. `{ session, collation }`.
   */
  async aggregate<TResult = any>({
    pipeline,
    options,
  }: {
    pipeline: PipelineStage[];
    options?: AggregateOptions;
  }): Promise<TResult[]> {
    const aggregation = this.model.aggregate<TResult>(pipeline);
    if (options) aggregation.option(options);
    return aggregation.exec();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── Update ────────────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Find a document by `_id`, apply the update, and return the result.
   * Defaults to `{ new: true }` — returns the document **after** the update.
   * Pass `{ new: false }` in options to get the document **before** the update.
   *
   * @param id      - The document `_id` as a string.
   * @param update  - Update query or aggregation pipeline.
   * @param options - QueryOptions. `new` defaults to `true`.
   */
  async findByIdAndUpdate({
    id,
    update,
    options,
  }: {
    id: string;
    update: UpdateQuery<TRawDoc> | UpdateWithAggregationPipeline;
    options?: QueryOptions<TRawDoc> & { new?: boolean };
  }): Promise<HydratedDocument<TRawDoc> | null> {
    return this.model.findByIdAndUpdate(id, this.resolveUpdate(update), {
      new: true,
      ...options,
    });
  }

  /**
   * Find the first document matching the filter, apply the update, and return the result.
   * Defaults to `{ new: true }` — returns the document **after** the update.
   *
   * @param filter  - MongoDB query filter.
   * @param update  - Update query or aggregation pipeline.
   * @param upsert  - If `true`, creates the document if no match is found. Defaults to `false`.
   * @param options - QueryOptions. `new` defaults to `true`.
   */
  async findOneAndUpdate({
    filter,
    update,
    upsert = false,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    update: UpdateQuery<TRawDoc> | UpdateWithAggregationPipeline;
    upsert?: boolean;
    options?: QueryOptions<TRawDoc> & { new?: boolean };
  }): Promise<HydratedDocument<TRawDoc> | null> {
    return this.model.findOneAndUpdate(filter, this.resolveUpdate(update), {
      new: true,
      upsert,
      ...options,
    });
  }

  /**
   * Update the first document matching the filter.
   * Does NOT return the updated document — use `findOneAndUpdate` if you need it.
   * Returns a `UpdateResult` with `matchedCount` and `modifiedCount`.
   *
   * @param filter  - MongoDB query filter.
   * @param update  - Update query or aggregation pipeline.
   * @param options - Additional update options.
   */
  async updateOne({
    filter,
    update,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    update: UpdateQuery<TRawDoc> | UpdateWithAggregationPipeline;
    options?: UpdateQueryOptions<TRawDoc>;
  }): Promise<mongo.UpdateResult> {
    return this.model.updateOne(filter, this.resolveUpdate(update), { ...options });
  }

  /**
   * Update all documents matching the filter.
   * Does NOT return the updated documents — use `findMany` after if needed.
   * Returns a `UpdateResult` with `matchedCount` and `modifiedCount`.
   *
   * @param filter  - MongoDB query filter.
   * @param update  - Update query or aggregation pipeline.
   * @param options - Additional update options.
   */
  async updateMany({
    filter,
    update,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    update: UpdateQuery<TRawDoc> | UpdateWithAggregationPipeline;
    options?: UpdateQueryOptions<TRawDoc>;
  }): Promise<mongo.UpdateResult> {
    return this.model.updateMany(filter, this.resolveUpdate(update), { ...options });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── Delete ────────────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Find a document by `_id`, delete it, and return the deleted document.
   * Returns `null` if no document matched.
   *
   * @param id      - The document `_id` as a string.
   * @param options - Additional QueryOptions.
   */
  async findByIdAndDelete({
    id,
    options,
  }: {
    id: string;
    options?: QueryOptions<TRawDoc>;
  }): Promise<HydratedDocument<TRawDoc> | null> {
    return this.model.findByIdAndDelete(id, { ...options });
  }

  /**
   * Find the first document matching the filter, delete it, and return the deleted document.
   * Returns `null` if no document matched.
   *
   * @param filter  - MongoDB query filter.
   * @param options - Additional QueryOptions.
   */
  async findOneAndDelete({
    filter,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    options?: QueryOptions<TRawDoc>;
  }): Promise<HydratedDocument<TRawDoc> | null> {
    return this.model.findOneAndDelete(filter, { ...options });
  }

  /**
   * Delete the first document matching the filter.
   * Does NOT return the deleted document — use `findOneAndDelete` if you need it.
   * Returns a `DeleteResult` with `deletedCount`.
   *
   * @param filter  - MongoDB query filter.
   * @param options - Additional delete options.
   */
  async deleteOne({
    filter,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    options?: DeleteQueryOptions<TRawDoc>;
  }): Promise<mongo.DeleteResult> {
    return this.model.deleteOne(filter, { ...options });
  }

  /**
   * Delete all documents matching the filter.
   * Does NOT return the deleted documents.
   * Returns a `DeleteResult` with `deletedCount`.
   *
   * @param filter  - MongoDB query filter.
   * @param options - Additional delete options.
   */
  async deleteMany({
    filter,
    options,
  }: {
    filter: QueryFilter<TRawDoc>;
    options?: DeleteQueryOptions<TRawDoc>;
  }): Promise<mongo.DeleteResult> {
    return this.model.deleteMany(filter, { ...options });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── Bulk ──────────────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute multiple write operations (insert/update/delete) in a single
   * round trip. Use for batch operations where per-document overhead matters.
   *
   * @param operations - Array of bulk write operations.
   * @param options    - Additional bulk write options, e.g. `{ session, ordered }`.
   */
  async bulkWrite({
    operations,
    options,
  }: {
    operations: mongo.AnyBulkWriteOperation[];
    options?: mongo.BulkWriteOptions & MongooseBulkWriteOptions;
  }): Promise<mongo.BulkWriteResult> {
    return this.model.bulkWrite<TRawDoc>(operations as any, options);
  }
}