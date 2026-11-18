from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    cognito_region: str = "eu-central-1"
    cognito_user_pool_id: str
    cognito_client_id: str
    # JWKS JSON of the user pool. Set by Terraform on Lambda (no internet in the VPC);
    # empty locally -> fetched once from Cognito at startup.
    cognito_jwks: str = ""
    cors_origins: str = "http://localhost:5173"
    # S3 bucket behind the site; admins upload look covers to img/looks/ (empty locally -> uploads disabled)
    upload_bucket: str = ""
    region: str = "eu-central-1"

    @property
    def cognito_issuer(self) -> str:
        return f"https://cognito-idp.{self.cognito_region}.amazonaws.com/{self.cognito_user_pool_id}"


settings = Settings()
