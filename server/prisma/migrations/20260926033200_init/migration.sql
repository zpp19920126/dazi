-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `password_hash` VARCHAR(100) NOT NULL,
    `real_name` VARCHAR(50) NOT NULL,
    `role` ENUM('admin', 'teacher', 'student') NOT NULL,
    `class_id` INTEGER NULL,
    `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
    `must_change_password` BOOLEAN NOT NULL DEFAULT true,
    `created_by` INTEGER NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `class` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `teacher_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `text` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL,
    `language` ENUM('zh', 'en') NOT NULL,
    `difficulty` INTEGER NOT NULL,
    `content` TEXT NOT NULL,
    `char_count` INTEGER NOT NULL,
    `created_by` INTEGER NULL,
    `status` ENUM('published', 'offline') NOT NULL DEFAULT 'published',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `class_id` INTEGER NOT NULL,
    `text_id` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `mode` ENUM('article', 'time') NOT NULL,
    `duration_seconds` INTEGER NULL,
    `min_speed` INTEGER NOT NULL,
    `min_accuracy` INTEGER NOT NULL,
    `deadline` DATETIME(3) NOT NULL,
    `status` ENUM('published', 'closed') NOT NULL DEFAULT 'published',
    `created_by` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `record` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `task_id` INTEGER NULL,
    `mode` ENUM('article', 'time') NOT NULL,
    `speed` DECIMAL(6, 2) NOT NULL,
    `accuracy` DECIMAL(5, 2) NOT NULL,
    `total_chars` INTEGER NOT NULL,
    `correct_chars` INTEGER NOT NULL,
    `backspace_count` INTEGER NOT NULL,
    `duration_seconds` INTEGER NOT NULL,
    `is_passed` BOOLEAN NULL,
    `is_suspicious` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `heartbeat` (
    `user_id` INTEGER NOT NULL,
    `task_id` INTEGER NULL,
    `status` ENUM('typing', 'paused', 'finished') NOT NULL,
    `speed` DECIMAL(6, 2) NOT NULL,
    `accuracy` DECIMAL(5, 2) NOT NULL,
    `progress` DECIMAL(5, 2) NOT NULL,
    `elapsed_seconds` INTEGER NOT NULL,
    `char_index` INTEGER NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_class_id_fkey` FOREIGN KEY (`class_id`) REFERENCES `class`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `class` ADD CONSTRAINT `class_teacher_id_fkey` FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task` ADD CONSTRAINT `task_class_id_fkey` FOREIGN KEY (`class_id`) REFERENCES `class`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task` ADD CONSTRAINT `task_text_id_fkey` FOREIGN KEY (`text_id`) REFERENCES `text`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `record` ADD CONSTRAINT `record_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `record` ADD CONSTRAINT `record_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `heartbeat` ADD CONSTRAINT `heartbeat_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
