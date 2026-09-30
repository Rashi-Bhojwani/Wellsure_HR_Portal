/*
  Warnings:

  - You are about to drop the column `document_type` on the `employee_documents` table. All the data in the column will be lost.
  - Added the required column `category_id` to the `employee_documents` table without a default value. This is not possible if the table is not empty.
  - Added the required column `title` to the `employee_documents` table without a default value. This is not possible if the table is not empty.

*/
-- Phase 5 commit C. employee_documents existed since Phase 1 but nothing
-- ever wrote to it; its free-text document_type is replaced by a real
-- category FK. Refuse rather than guess a mapping if rows exist anywhere.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "employee_documents") THEN
    RAISE EXCEPTION 'employee_documents is not empty: map document_type to document_categories by hand before applying this migration';
  END IF;
END $$;

-- Announcement scope FKs: SET NULL -> RESTRICT. SET NULL silently turned a
-- branch/department-scoped announcement into an org-wide one when its
-- branch was deleted or merged away; org/service.ts now repoints on merge
-- and blocks delete, and RESTRICT is the database-level backstop.
-- CreateEnum
CREATE TYPE "DocumentCategoryScope" AS ENUM ('COMPANY', 'EMPLOYEE');

-- DropForeignKey
ALTER TABLE "announcements" DROP CONSTRAINT "announcements_scope_department_id_fkey";

-- DropForeignKey
ALTER TABLE "announcements" DROP CONSTRAINT "announcements_scope_location_id_fkey";

-- AlterTable
ALTER TABLE "employee_documents" DROP COLUMN "document_type",
ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "archived_by_user_id" TEXT,
ADD COLUMN     "category_id" TEXT NOT NULL,
ADD COLUMN     "title" TEXT NOT NULL,
ADD COLUMN     "visible_to_employee" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "employee_personal" ADD COLUMN     "photo_thumb_storage_key" TEXT,
ADD COLUMN     "photo_version" TEXT;

-- CreateTable
CREATE TABLE "document_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "applies_to" "DocumentCategoryScope" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category_id" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "scope_location_id" TEXT,
    "scope_department_id" TEXT,
    "uploaded_by_user_id" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),
    "archived_by_user_id" TEXT,

    CONSTRAINT "company_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_document_downloads" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "first_downloaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_downloaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "download_count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "company_document_downloads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_categories_code_key" ON "document_categories"("code");

-- CreateIndex
CREATE INDEX "company_documents_category_id_idx" ON "company_documents"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_document_downloads_document_id_employee_id_key" ON "company_document_downloads"("document_id", "employee_id");

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "document_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_scope_location_id_fkey" FOREIGN KEY ("scope_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_scope_department_id_fkey" FOREIGN KEY ("scope_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "document_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_scope_location_id_fkey" FOREIGN KEY ("scope_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_scope_department_id_fkey" FOREIGN KEY ("scope_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_document_downloads" ADD CONSTRAINT "company_document_downloads_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "company_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_document_downloads" ADD CONSTRAINT "company_document_downloads_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
