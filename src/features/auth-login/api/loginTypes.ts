export type LoginSuccessResponse = {
  message: 'login success';
  data: {
    access_token: string;
    expires_in: number;
  };
};
