# Outfit agent: admins upload a look photo, Claude (Bedrock) lists its pieces, FashionCLIP turns each into a
# search vector. Outside the VPC (needs Bedrock; never touches the database). Code: backend/agent.
# The image must exist before the Lambda is created: run infra/deploy-agent.sh after applying the ECR repo.

resource "aws_ecr_repository" "agent" {
  name                 = "${var.project}-agent"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_ecr_lifecycle_policy" "agent" {
  repository = aws_ecr_repository.agent.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 3 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 3 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_iam_role" "agent" {
  name = "${var.project}-agent"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "agent_logs" {
  role       = aws_iam_role.agent.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# EU cross-region inference profile -> the underlying model in any EU region
resource "aws_iam_role_policy" "agent_bedrock" {
  role = aws_iam_role.agent.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["bedrock:InvokeModel"]
      Resource = [
        "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:inference-profile/${var.agent_model_id}",
        "arn:aws:bedrock:*::foundation-model/${trimprefix(var.agent_model_id, "eu.")}*",
      ]
    }]
  })
}

data "aws_caller_identity" "current" {}

resource "aws_cloudwatch_log_group" "agent" {
  name              = "/aws/lambda/${var.project}-agent"
  retention_in_days = 14
}

resource "aws_lambda_function" "agent" {
  function_name = "${var.project}-agent"
  role          = aws_iam_role.agent.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.agent.repository_url}:latest"
  architectures = ["arm64"]
  memory_size   = 3008 # torch + FashionCLIP; more memory = more CPU = faster cold start
  timeout       = 120

  environment {
    variables = {
      MODEL_ID             = var.agent_model_id
      COGNITO_REGION       = var.region
      COGNITO_USER_POOL_ID = aws_cognito_user_pool.main.id
      COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.web.id
      COGNITO_JWKS         = data.http.cognito_jwks.response_body
    }
  }

  depends_on = [aws_iam_role_policy_attachment.agent_logs, aws_cloudwatch_log_group.agent]

  lifecycle {
    ignore_changes = [image_uri] # deploy-agent.sh rolls out new images
  }
}

# Public HTTPS URL; the function itself only answers Cognito users in the "admins" group.
resource "aws_lambda_function_url" "agent" {
  function_name      = aws_lambda_function.agent.function_name
  authorization_type = "NONE"
  cors {
    allow_origins = concat(local.site_origins, ["http://localhost:5173"])
    allow_methods = ["POST"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

resource "aws_lambda_permission" "agent_url" {
  statement_id           = "FunctionURLAllowPublicAccess"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.agent.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "agent_url_invoke" {
  statement_id             = "FunctionURLAllowInvokeAction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.agent.function_name
  principal                = "*"
  invoked_via_function_url = true
}

# Who may build outfits: add accounts with
#   aws cognito-idp admin-add-user-to-group --user-pool-id <id> --username <username> --group-name admins
resource "aws_cognito_user_group" "admins" {
  name         = "admins"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Can open /admin and publish outfits"
}

# Admins upload look covers straight to S3 (presigned PUT from the main API) under img/looks/
resource "aws_iam_role_policy" "backend_uploads" {
  role = aws_iam_role.backend.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.frontend.arn}/img/looks/*" }]
  })
}

resource "aws_s3_bucket_cors_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  cors_rule {
    allowed_origins = concat(local.site_origins, ["http://localhost:5173"])
    allowed_methods = ["PUT"]
    allowed_headers = ["content-type"]
    max_age_seconds = 3600
  }
}
