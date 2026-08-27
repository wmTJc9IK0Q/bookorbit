CREATE TABLE "book_content_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "libraries" ADD COLUMN "embed_content" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "book_content_chunks" ADD CONSTRAINT "book_content_chunks_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bcc_book_id_chunk_index_uidx" ON "book_content_chunks" USING btree ("book_id","chunk_index");--> statement-breakpoint
CREATE INDEX "bcc_book_id_idx" ON "book_content_chunks" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "bcc_embedding_hnsw_cosine_idx" ON "book_content_chunks" USING hnsw ("embedding" vector_cosine_ops);