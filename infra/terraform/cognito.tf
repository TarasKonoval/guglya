# Pre-sign-up trigger: confirm users and verify their email immediately, so they can sign in right away.
data "archive_file" "presignup" {
  type        = "zip"
  source_file = "${path.module}/lambda/presignup.py"
  output_path = "${path.module}/build/presignup.zip"
}

resource "aws_iam_role" "presignup" {
  name = "${var.project}-presignup"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "presignup_logs" {
  role       = aws_iam_role.presignup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "presignup" {
  function_name    = "${var.project}-presignup"
  role             = aws_iam_role.presignup.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "presignup.handler"
  filename         = data.archive_file.presignup.output_path
  source_code_hash = data.archive_file.presignup.output_base64sha256
  timeout          = 5
}

resource "aws_lambda_permission" "cognito_presignup" {
  statement_id  = "AllowCognito"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.presignup.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}

resource "aws_cognito_user_pool" "main" {
  name                = var.project
  username_attributes = ["email"]
  deletion_protection = "INACTIVE"
  mfa_configuration   = "OFF"

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  password_policy {
    minimum_length                   = 8
    require_lowercase                = false
    require_uppercase                = false
    require_numbers                  = false
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  lambda_config {
    pre_sign_up = aws_lambda_function.presignup.arn
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name            = "${var.project}-web"
  user_pool_id    = aws_cognito_user_pool.main.id
  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
  prevent_user_existence_errors = "ENABLED"

  # OAuth (authorization code + PKCE) for "Увійти через Google"
  supported_identity_providers         = local.google_enabled ? ["COGNITO", "Google"] : ["COGNITO"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = local.oauth_urls
  logout_urls                          = local.oauth_urls

  depends_on = [aws_cognito_identity_provider.google]
}

# The backend Lambda has no internet access, so Terraform hands it the signing keys.
data "http" "cognito_jwks" {
  url = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}/.well-known/jwks.json"
}

# Hosted domain for OAuth (Google sign-in redirects through it). Classic hosted UI: no branding needed.
resource "aws_cognito_user_pool_domain" "main" {
  domain                = "${var.project}-auth"
  user_pool_id          = aws_cognito_user_pool.main.id
  managed_login_version = 1
}

locals {
  google_enabled = var.google_client_id != ""
  site_url       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
  oauth_urls     = ["${local.site_url}/", "http://localhost:5173/"]
}

resource "aws_cognito_identity_provider" "google" {
  count         = local.google_enabled ? 1 : 0
  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid email profile"
  }

  attribute_mapping = {
    email          = "email"
    email_verified = "email_verified"
    name           = "name"
    username       = "sub"
  }
}
