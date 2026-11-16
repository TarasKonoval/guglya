variable "region" {
  type    = string
  default = "eu-central-1"
}

variable "project" {
  type    = string
  default = "guglya"
}

variable "budget_email" {
  description = "Where AWS Budgets sends the $30/month alarm"
  type        = string
}

variable "budget_limit_usd" {
  type    = number
  default = 30
}
