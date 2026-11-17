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

variable "my_ip_cidr" {
  description = "Your laptop's public IP as /32, allowed to reach Postgres: echo \"$(curl -s https://checkip.amazonaws.com)/32\""
  type        = string
}

# Google sign-in (optional). Create an OAuth client in Google Cloud Console; keep these in terraform.tfvars only.
variable "google_client_id" {
  type    = string
  default = ""
}

variable "google_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}
