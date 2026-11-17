# Custom domain: Route 53 zone (1) -> nameservers set at the registrar (manual) -> ACM cert + CloudFront alias (2).
locals {
  has_domain    = var.domain_name != ""
  domain_active = local.has_domain && var.domain_delegated
  site_origins  = concat(["https://${aws_cloudfront_distribution.frontend.domain_name}"], local.domain_active ? ["https://${var.domain_name}"] : [])
}

resource "aws_route53_zone" "main" {
  count = local.has_domain ? 1 : 0
  name  = var.domain_name
}

resource "aws_acm_certificate" "site" {
  count                     = local.domain_active ? 1 : 0
  provider                  = aws.us_east_1
  domain_name               = var.domain_name
  subject_alternative_names = ["www.${var.domain_name}"]
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

# www.guglya.studio -> 301 -> guglya.studio
resource "aws_cloudfront_function" "www_redirect" {
  name    = "${var.project}-www-redirect"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var req = event.request;
      var host = req.headers.host && req.headers.host.value;
      if (host && host.indexOf("www.") === 0) {
        var qs = Object.keys(req.querystring).map(function (k) {
          return k + "=" + encodeURIComponent(req.querystring[k].value);
        }).join("&");
        return {
          statusCode: 301,
          statusDescription: "Moved Permanently",
          headers: { location: { value: "https://" + host.substring(4) + req.uri + (qs ? "?" + qs : "") } },
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
