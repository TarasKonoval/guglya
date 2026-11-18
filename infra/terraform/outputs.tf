output "api_url" {
  value = aws_apigatewayv2_api.backend.api_endpoint
}

output "cloudfront_url" {
  value = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.frontend.id
}

output "frontend_bucket" {
  value = aws_s3_bucket.frontend.bucket
}

output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "db_endpoint" {
  value = aws_db_instance.main.address
}

output "ecr_repository_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "backend_function_name" {
  value = aws_lambda_function.backend.function_name
}

output "database_url_ssm_parameter" {
  value = aws_ssm_parameter.database_url.name
}

locals {
  auth_domain = local.domain_active ? "auth.${var.domain_name}" : "${var.project}-auth.auth.${var.region}.amazoncognito.com"
}

# The frontend uses this one; the prefix domain keeps working too.
output "cognito_domain" {
  value = local.auth_domain
}

output "google_redirect_uri" {
  description = "Paste into Google Cloud Console -> OAuth client -> Authorized redirect URIs"
  value       = "https://${local.auth_domain}/oauth2/idpresponse"
}

output "google_enabled" {
  value = local.google_enabled
}

output "name_servers" {
  description = "Set these as the domain's nameservers at the registrar"
  value       = local.has_domain ? aws_route53_zone.main[0].name_servers : []
}

output "site_url" {
  value = local.domain_active ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "agent_url" {
  value = aws_lambda_function_url.agent.function_url
}

output "agent_ecr_repository_url" {
  value = aws_ecr_repository.agent.repository_url
}

output "agent_function_name" {
  value = aws_lambda_function.agent.function_name
}
