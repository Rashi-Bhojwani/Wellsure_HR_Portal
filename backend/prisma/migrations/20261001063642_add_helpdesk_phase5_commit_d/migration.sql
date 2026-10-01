-- CreateEnum
CREATE TYPE "HelpdeskTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_EMPLOYEE', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "HelpdeskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateTable
CREATE TABLE "helpdesk_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "default_assignee_employee_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "helpdesk_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpdesk_tickets" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "raised_by_employee_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "priority" "HelpdeskPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "HelpdeskTicketStatus" NOT NULL DEFAULT 'OPEN',
    "assignee_employee_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "helpdesk_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpdesk_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "author_employee_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_internal_note" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "helpdesk_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpdesk_attachments" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "helpdesk_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "helpdesk_categories_code_key" ON "helpdesk_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "helpdesk_tickets_number_key" ON "helpdesk_tickets"("number");

-- CreateIndex
CREATE INDEX "helpdesk_tickets_raised_by_employee_id_idx" ON "helpdesk_tickets"("raised_by_employee_id");

-- CreateIndex
CREATE INDEX "helpdesk_tickets_assignee_employee_id_idx" ON "helpdesk_tickets"("assignee_employee_id");

-- CreateIndex
CREATE INDEX "helpdesk_tickets_status_resolved_at_idx" ON "helpdesk_tickets"("status", "resolved_at");

-- CreateIndex
CREATE INDEX "helpdesk_messages_ticket_id_created_at_idx" ON "helpdesk_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "helpdesk_attachments_message_id_idx" ON "helpdesk_attachments"("message_id");

-- AddForeignKey
ALTER TABLE "helpdesk_categories" ADD CONSTRAINT "helpdesk_categories_default_assignee_employee_id_fkey" FOREIGN KEY ("default_assignee_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_raised_by_employee_id_fkey" FOREIGN KEY ("raised_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "helpdesk_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_assignee_employee_id_fkey" FOREIGN KEY ("assignee_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_messages" ADD CONSTRAINT "helpdesk_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "helpdesk_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_messages" ADD CONSTRAINT "helpdesk_messages_author_employee_id_fkey" FOREIGN KEY ("author_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_attachments" ADD CONSTRAINT "helpdesk_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "helpdesk_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
