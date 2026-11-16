import { Amplify } from "aws-amplify";

export function configureAuth() {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
        userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
        loginWith: { email: true },
      },
    },
  });
}

const MESSAGES: Record<string, string> = {
  UsernameExistsException: "Акаунт з таким email вже існує — увійди.",
  NotAuthorizedException: "Невірний email або пароль.",
  UserNotFoundException: "Невірний email або пароль.",
  InvalidPasswordException: "Пароль має містити щонайменше 8 символів.",
  InvalidParameterException: "Перевір email і пароль (пароль — від 8 символів).",
  LimitExceededException: "Забагато спроб. Спробуй за кілька хвилин.",
};

export function authErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  return MESSAGES[name] ?? (e as Error)?.message ?? "Щось пішло не так.";
}
