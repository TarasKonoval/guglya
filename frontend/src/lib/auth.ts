import { Amplify } from "aws-amplify";

export const GOOGLE_ENABLED = import.meta.env.VITE_GOOGLE_ENABLED === "true";

export function configureAuth() {
  const home = `${window.location.origin}/`;
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
        userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
        loginWith: {
          email: true,
          oauth: {
            domain: import.meta.env.VITE_COGNITO_DOMAIN ?? "",
            scopes: ["openid", "email", "profile"],
            redirectSignIn: [home],
            redirectSignOut: [home],
            responseType: "code",
          },
        },
      },
    },
  });
}

const MESSAGES: Record<string, string> = {
  UsernameExistsException: "Акаунт з таким email вже існує — увійди.",
  NotAuthorizedException: "Невірний email або пароль.",
  UserNotFoundException: "Невірний email або пароль.",
  InvalidPasswordException: "Слабкий пароль: потрібно щонайменше 8 символів.",
  InvalidParameterException: "Перевір email і пароль (пароль — від 8 символів).",
  EmptySignUpPassword: "Введи пароль.",
  EmptySignInPassword: "Введи пароль.",
  LimitExceededException: "Забагато спроб. Спробуй за кілька хвилин.",
  TooManyRequestsException: "Забагато спроб. Спробуй за кілька хвилин.",
  UserAlreadyAuthenticatedException: "Ти вже увійшов(-ла). Онови сторінку.",
  NetworkError: "Немає зʼєднання з інтернетом.",
};

export function authErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  return MESSAGES[name] ?? "Щось пішло не так. Спробуй ще раз.";
}
