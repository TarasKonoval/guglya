resource "random_password" "db" {
  length  = 32
  special = false # keeps the DATABASE_URL free of characters that need escaping
}

resource "aws_db_subnet_group" "default" {
  name       = "${var.project}-default-vpc"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t4g.micro"

  allocated_storage = 20
  storage_type      = "gp3"

  db_name  = var.project
  username = "${var.project}_admin"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.default.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = true
  multi_az               = false

  backup_retention_period = 1
  deletion_protection     = false
  skip_final_snapshot     = true
  apply_immediately       = true
}

locals {
  # RDS for PostgreSQL 16 enforces SSL by default (rds.force_ssl=1); require it client-side too.
  database_url = "postgresql://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}?sslmode=require"
}

resource "aws_ssm_parameter" "db_password" {
  name  = "/${var.project}/db_password"
  type  = "SecureString"
  value = random_password.db.result
}

resource "aws_ssm_parameter" "database_url" {
  name  = "/${var.project}/database_url"
  type  = "SecureString"
  value = local.database_url
}
