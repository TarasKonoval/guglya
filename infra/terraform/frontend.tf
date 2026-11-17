resource "aws_s3_bucket" "frontend" {
  bucket_prefix = "${var.project}-frontend-"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project}-frontend"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  aliases             = local.domain_active ? [var.domain_name, "www.${var.domain_name}"] : []
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  comment             = "${var.project} frontend"

  origin {
    origin_id                = "s3"
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_redirect.arn
    }
  }

  # SPA: unknown paths (private bucket answers 403) are served by index.html
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !local.domain_active
    acm_certificate_arn            = local.domain_active ? aws_acm_certificate_validation.site[0].certificate_arn : null
    ssl_support_method             = local.domain_active ? "sni-only" : null
    minimum_protocol_version       = local.domain_active ? "TLSv1.2_2021" : "TLSv1"
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn } }
    }]
  })
}
