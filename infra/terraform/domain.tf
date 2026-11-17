# Custom domain: Route 53 zone (1) -> nameservers set at the registrar (manual) -> ACM cert + CloudFront alias (2).
locals {
  has_domain    = var.domain_name != ""
  domain_active = local.has_domain && var.domain_delegated
  # With a custom domain, it is the only public origin (the *.cloudfront.net name just redirects to it).
  site_origins = local.domain_active ? ["https://${var.domain_name}"] : ["https://${aws_cloudfront_distribution.frontend.domain_name}"]
}

resource "aws_route53_zone" "main" {
  count = local.has_domain ? 1 : 0
  name  = var.domain_name
}

resource "aws_acm_certificate" "site" {
  count                     = local.domain_active ? 1 : 0
  provider                  = aws.us_east_1
  domain_name               = var.domain_name
  subject_alternative_names = ["www.${var.domain_name}", "auth.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = local.domain_active ? {
    for o in aws_acm_certificate.site[0].domain_validation_options : o.domain_name => o
  } : {}
  zone_id         = aws_route53_zone.main[0].zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "site" {
  count                   = local.domain_active ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.site[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# www.<domain> and *.cloudfront.net -> 301 -> https://<domain> (only once the custom domain is live)
resource "aws_cloudfront_function" "www_redirect" {
  name    = "${var.project}-www-redirect"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    var CANONICAL = "${local.domain_active ? var.domain_name : ""}";
    function handler(event) {
      var req = event.request;
      var host = (req.headers.host && req.headers.host.value) || "";
      if (CANONICAL && host !== CANONICAL) {
        var qs = Object.keys(req.querystring).map(function (k) {
          return k + "=" + encodeURIComponent(req.querystring[k].value);
        }).join("&");
        return {
          statusCode: 301,
          statusDescription: "Moved Permanently",
          headers: { location: { value: "https://" + CANONICAL + req.uri + (qs ? "?" + qs : "") } },
        };
      }
      return req;
    }
  JS
}

resource "aws_route53_record" "site" {
  for_each = local.domain_active ? toset(["A", "AAAA"]) : toset([])
  zone_id  = aws_route53_zone.main[0].zone_id
  name     = var.domain_name
  type     = each.value
  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www" {
  for_each = local.domain_active ? toset(["A", "AAAA"]) : toset([])
  zone_id  = aws_route53_zone.main[0].zone_id
  name     = "www.${var.domain_name}"
  type     = each.value
  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}

# auth.guglya.studio: Cognito custom domain, so Google's consent screen shows our domain.
# Cognito requires the parent domain to resolve first, hence depends_on the apex A record.
resource "aws_cognito_user_pool_domain" "custom" {
  count                 = local.domain_active ? 1 : 0
  domain                = "auth.${var.domain_name}"
  user_pool_id          = aws_cognito_user_pool.main.id
  certificate_arn       = aws_acm_certificate_validation.site[0].certificate_arn
  managed_login_version = 1
  depends_on            = [aws_route53_record.site]
}

resource "aws_route53_record" "auth" {
  count   = local.domain_active ? 1 : 0
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "auth.${var.domain_name}"
  type    = "A"
  alias {
    name                   = aws_cognito_user_pool_domain.custom[0].cloudfront_distribution
    zone_id                = aws_cognito_user_pool_domain.custom[0].cloudfront_distribution_zone_id
    evaluate_target_health = false
  }
}
