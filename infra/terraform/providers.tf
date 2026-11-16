terraform {
  required_version = ">= 1.6"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
    http    = { source = "hashicorp/http", version = "~> 3.4" }
    archive = { source = "hashicorp/archive", version = "~> 2.4" }
  }
  # Local state (gitignored). Keep terraform.tfstate safe: it contains the DB password.
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = var.project }
  }
}
