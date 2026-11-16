# Everything lives in the account's default VPC (public subnets, no NAT).
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Laptop's current public IP, allowed to reach Postgres for migrations/seeding.
data "http" "my_ip" {
  url = "https://checkip.amazonaws.com"
}

locals {
  my_ip_cidr = "${chomp(data.http.my_ip.response_body)}/32"
}

resource "aws_security_group" "lambda" {
  name        = "${var.project}-lambda"
  description = "Backend Lambda"
  vpc_id      = data.aws_vpc.default.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name        = "${var.project}-db"
  description = "Postgres: backend Lambda + developer laptop"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Backend Lambda"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  ingress {
    description = "Developer laptop"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [local.my_ip_cidr]
  }
}
