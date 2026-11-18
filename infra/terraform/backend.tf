resource "aws_ecr_repository" "backend" {
  name                 = "${var.project}-backend"
  image_tag_mutability = "MUTABLE"
  force_delete         = true # so `terraform destroy` works with images inside
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 5 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 5 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_iam_role" "backend" {
  name = "${var.project}-backend"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "backend_vpc" {
  role       = aws_iam_role.backend.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/aws/lambda/${var.project}-backend"
  retention_in_days = 14
}

# The image must exist before this is created: run infra/deploy-backend.sh after applying the ECR repo.
resource "aws_lambda_function" "backend" {
  function_name = "${var.project}-backend"
  role          = aws_iam_role.backend.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.backend.repository_url}:latest"
  architectures = ["arm64"]
  memory_size   = 512
  timeout       = 15

  vpc_config {
    subnet_ids         = data.aws_subnets.default.ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      DATABASE_URL         = local.database_url
      COGNITO_REGION       = var.region
      COGNITO_USER_POOL_ID = aws_cognito_user_pool.main.id
      COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.web.id
      COGNITO_JWKS         = data.http.cognito_jwks.response_body
      CORS_ORIGINS         = join(",", concat(local.site_origins, ["http://localhost:5173"]))
      UPLOAD_BUCKET        = aws_s3_bucket.frontend.id
    }
  }

  depends_on = [aws_iam_role_policy_attachment.backend_vpc, aws_cloudwatch_log_group.backend]

  lifecycle {
    ignore_changes = [image_uri] # deploy-backend.sh rolls out new images
  }
}

# HTTPS endpoint. CORS is handled only by FastAPI, not here.
resource "aws_apigatewayv2_api" "backend" {
  name          = "${var.project}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "backend" {
  api_id                 = aws_apigatewayv2_api.backend.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.backend.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.backend.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.backend.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.backend.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 20
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backend.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.backend.execution_arn}/*/*"
}
