def handler(event, context):
    """Cognito pre-sign-up trigger: let new users sign in immediately, without an email code."""
    event["response"]["autoConfirmUser"] = True
    if "email" in event["request"]["userAttributes"]:
        event["response"]["autoVerifyEmail"] = True
    return event
