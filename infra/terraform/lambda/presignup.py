def handler(event, context):
    """Cognito pre-sign-up trigger. Email sign-ups confirm themselves with the emailed code; only Google sign-ins
    (already verified by Google) are confirmed here."""
    if event.get("triggerSource") == "PreSignUp_ExternalProvider":
        event["response"]["autoConfirmUser"] = True
        if "email" in event["request"]["userAttributes"]:
            event["response"]["autoVerifyEmail"] = True
    return event
