export const emailTemplate = (code: string | number, email: string, title: string, subject: string) => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Fakebook – Verify Your Email</title>
</head>
<body style="margin:0;padding:0;background-color:#0d0d0f;font-family:Arial,sans-serif;">

  <!-- Outer centering table -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0d0d0f;padding:40px 16px;">
    <tr>
      <td align="center">

        <!-- Card -->
        <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background-color:#131316;border:1px solid #2a2a30;border-radius:20px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:40px 48px 36px;border-bottom:1px solid #1e1e24;background-color:#131316;">

              <!-- Logo row -->
              <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="width:34px;height:34px;background:linear-gradient(135deg,#1877f2,#3b82f6);border-radius:9px;text-align:center;vertical-align:middle;padding:0 8px;">
                    <span style="color:#fff;font-size:18px;font-weight:bold;">F</span>
                  </td>
                  <td style="padding-left:10px;font-size:17px;font-weight:700;color:#f0f0f5;letter-spacing:-0.3px;">
                    Fakebook
                  </td>
                </tr>
              </table>

              <!-- Title -->
              <div style="font-size:28px;font-weight:800;color:#f0f0f5;line-height:1.2;letter-spacing:-0.5px;">
                Verify your<br/>
                <span style="color:#3b82f6;">${title}</span>
              </div>

            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 48px;background-color:#131316;">

              <!-- Greeting -->
              <p style="font-size:15px;color:#9898aa;line-height:1.7;margin:0 0 28px 0;">
                Hi <strong style="color:#d4d4e8;font-weight:600;">there</strong>,<br/><br/>
                Someone (hopefully you) requested a one-time passcode to ${subject}.
                Use the code below to complete verification.
              </p>

              <!-- OTP Label -->
              <p style="font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#6b6b80;margin:0 0 14px 0;">
                Your one-time code
              </p>

              <!-- OTP Block -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0d0d0f;border:1px solid #2a2a30;border-radius:14px;margin-bottom:28px;border-left:3px solid #1877f2;">
                <tr>
                  <td style="padding:28px 32px;text-align:center;">
                    <span style="font-family:'Courier New',Courier,monospace;font-size:38px;font-weight:700;color:#dbeafe;letter-spacing:12px;">
                      ${code}
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Expiry Warning -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:rgba(239,155,50,0.07);border:1px solid rgba(239,155,50,0.25);border-radius:10px;margin-bottom:28px;">
                <tr>
                  <td style="padding:14px 18px;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding-right:10px;vertical-align:middle;font-size:16px;">⏱</td>
                        <td style="font-size:13px;color:#c08030;font-weight:500;line-height:1.5;">
                          This code expires in <strong style="color:#e09040;">5 minutes</strong>. Don't share it with anyone.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
                <tr>
                  <td style="height:1px;background-color:#1e1e24;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>

              <!-- Security Note -->
              <p style="font-size:13px;color:#6b6b7a;line-height:1.7;margin:0;">
                If you didn't request this code, you can safely ignore this email.
                Someone may have entered your email address by mistake.<br/><br/>
                Need help?
                <a href="#" style="color:#3b82f6;text-decoration:none;">Contact our support team</a>
                — we're always around.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 48px;border-top:1px solid #1e1e24;background-color:#0f0f12;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:12px;color:#444450;font-weight:600;letter-spacing:0.5px;">
                    © 2026 FAKEBOOK
                  </td>
                  <td align="right">
                    <a href="#" style="font-size:12px;color:#444450;text-decoration:none;margin-left:16px;">Privacy</a>
                    <a href="#" style="font-size:12px;color:#444450;text-decoration:none;margin-left:16px;">Terms</a>
                    <a href="#" style="font-size:12px;color:#444450;text-decoration:none;margin-left:16px;">Unsubscribe</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- End Card -->

        <!-- Meta -->
        <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;margin-top:16px;">
          <tr>
            <td style="text-align:center;font-size:11px;color:#3a3a48;line-height:1.8;">
              Sent to <a href="#" style="color:#3b82f6;text-decoration:none;">${email}</a><br/> ·
              <a href="#" style="color:#3b82f6;text-decoration:none;">Manage preferences</a><br/>
              Fakebook Inc., 123 Privacy Lane, San Francisco, CA 94103
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
};
