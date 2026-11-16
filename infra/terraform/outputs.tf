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
