const awsconfig = {
  Auth: {
    Cognito: {
      region: "ap-south-1",
      userPoolId: "ap-south-1_STFmvl7aq",
      userPoolClientId: "2sugbl975ohnl4dkptqq7sq8f4",
      identityPoolId: "ap-south-1:1055c263-776d-4a24-acb7-7c9a73916ca6",

      loginWith: {
        oauth: {
          domain: "ap-south-1stfmvl7aq.auth.ap-south-1.amazoncognito.com",
          scopes: ["openid", "email", "profile"],

          redirectSignIn: [
              "https://file-sharing-app-with-aws-cloud.vercel.app/",
              "https://file-sharing-rho-pied.vercel.app/",
              "http://localhost:5173/"
               ],

          redirectSignOut: [
              "https://file-sharing-app-with-aws-cloud.vercel.app/",
              "https://file-sharing-rho-pied.vercel.app/",
              "http://localhost:5173/"
                    ],
          responseType: "code",
        },
      },
    },
  },

  Storage: {
    S3: {
      bucket: "dinesh-file-storage-2026",
      region: "ap-south-1",
    },
  },
};

export default awsconfig;
