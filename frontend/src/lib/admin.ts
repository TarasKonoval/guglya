/** Is the signed-in user in the Cognito "admins" group? Set by App from the ID token; only shows admin
 *  controls (the API checks the group itself on every admin call). */
let admin = false;

export const setAdmin = (value: boolean) => {
  admin = value;
};
export const isAdmin = () => admin;
