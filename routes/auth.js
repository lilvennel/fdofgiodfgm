const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

// ============================================
// 1. Pedir recuperación de contraseña
// POST /api/forgot-password
// Body: { email: "usuario@gmail.com" }
// ============================================
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'El email es requerido' });
    }

    // ⚠️ Acá tenés que buscar el usuario en tu base de datos
    // Ejemplo genérico (adaptá según tu DB):
    // const user = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    
    // Por ahora simulamos que el usuario existe
    const user = { id: 1, email, name: 'Usuario' }; // ← reemplazá esto

    if (!user) {
      // Por seguridad, no decimos si el email existe o no
      return res.json({ message: 'Si el email existe, te enviamos un enlace' });
    }

    // Generar token único
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    // ⚠️ Guardar el token en tu base de datos
    // Ejemplo:
    // await db.query(
    //   'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
    //   [token, expiresAt, user.id]
    // );

    const resetLink = `https://fdofgiodfgm-dfdsfg.up.railway.app/reset-password?token=${token}`;

    // Enviar email con Resend
    await resend.emails.send({
      from: 'AsistOK <onboarding@resend.dev>', // después cambiá por tu dominio
      to: email,
      subject: 'Restablecé tu contraseña - AsistOK',
      html: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin:0; padding:0; background-color:#f0fdfa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdfa; padding: 40px 16px;">
            <tr>
              <td align="center">
                <table width="100%" style="max-width: 520px; background-color:#ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(15, 118, 110, 0.08);">
                  <tr>
                    <td style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding: 32px 40px; text-align: center;">
                      <span style="color: #ffffff; font-size: 22px; font-weight: 700;">⏱ AsistOK</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 40px 40px 32px;">
                      <h1 style="margin: 0 0 12px; font-size: 24px; font-weight: 700; color: #0f172a;">Restablecé tu contraseña</h1>
                      <p style="margin: 0 0 28px; font-size: 15px; color: #64748b; line-height: 1.6;">
                        Hola, recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong style="color:#0f766e;">AsistOK</strong>.
                      </p>
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                        <tr>
                          <td align="center">
                            <a href="${resetLink}" style="display: inline-block; background-color: #0f766e; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 10px;">
                              Restablecer contraseña
                            </a>
                          </td>
                        </tr>
                      </table>
                      <p style="margin: 0 0 8px; font-size: 14px; color: #64748b;">Este enlace es válido por <strong>60 minutos</strong>.</p>
                      <p style="margin: 0; font-size: 14px; color: #64748b;">Si no solicitaste este cambio, podés ignorar este correo.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="background-color: #f8fafc; padding: 24px 40px; text-align: center; border-top: 1px solid #e2e8f0;">
                      <p style="margin: 0; font-size: 13px; color: #64748b;">© 2025 AsistOK · Control de asistencia</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
    });

    res.json({ message: 'Si el email existe, te enviamos un enlace' });

  } catch (error) {
    console.error('Error en forgot-password:', error);
    res.status(500).json({ error: 'Error al enviar el email' });
  }
});

// ============================================
// 2. Página para poner la nueva contraseña
// GET /reset-password?token=xxxxx
// ============================================
router.get('/reset-password', (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send('Token inválido');
  }

  // Página HTML simple para poner la nueva contraseña
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Restablecer contraseña - AsistOK</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0fdfa; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .card { background: white; border-radius: 16px; padding: 40px; max-width: 420px; width: 100%; box-shadow: 0 4px 24px rgba(15, 118, 110, 0.08); }
        h1 { font-size: 24px; color: #0f172a; margin-bottom: 8px; }
        p { color: #64748b; margin-bottom: 24px; font-size: 15px; }
        label { display: block; font-size: 14px; color: #334155; margin-bottom: 6px; font-weight: 500; }
        input { width: 100%; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 15px; margin-bottom: 16px; }
        input:focus { outline: none; border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.15); }
        button { width: 100%; background: #0f766e; color: white; border: none; padding: 14px; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; }
        button:hover { background: #0d9488; }
        .error { color: #dc2626; font-size: 14px; margin-top: 12px; display: none; }
        .success { color: #0f766e; font-size: 14px; margin-top: 12px; display: none; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Nueva contraseña</h1>
        <p>Ingresá tu nueva contraseña para AsistOK</p>
        
        <form id="resetForm">
          <label>Nueva contraseña</label>
          <input type="password" id="password" required minlength="6" placeholder="Mínimo 6 caracteres">
          
          <label>Confirmar contraseña</label>
          <input type="password" id="confirm" required minlength="6" placeholder="Repetí la contraseña">
          
          <button type="submit">Guardar nueva contraseña</button>
          <p class="error" id="error"></p>
          <p class="success" id="success"></p>
        </form>
      </div>

      <script>
        document.getElementById('resetForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const password = document.getElementById('password').value;
          const confirm = document.getElementById('confirm').value;
          const errorEl = document.getElementById('error');
          const successEl = document.getElementById('success');

          errorEl.style.display = 'none';
          successEl.style.display = 'none';

          if (password !== confirm) {
            errorEl.textContent = 'Las contraseñas no coinciden';
            errorEl.style.display = 'block';
            return;
          }

          try {
            const res = await fetch('/api/reset-password', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: '${token}', password })
            });

            const data = await res.json();

            if (!res.ok) {
              errorEl.textContent = data.error || 'Error al cambiar la contraseña';
              errorEl.style.display = 'block';
              return;
            }

            successEl.textContent = '¡Contraseña actualizada! Ya podés iniciar sesión.';
            successEl.style.display = 'block';
            document.getElementById('resetForm').reset();

          } catch (err) {
            errorEl.textContent = 'Error de conexión';
            errorEl.style.display = 'block';
          }
        });
      </script>
    </body>
    </html>
  `);
});

// ============================================
// 3. Guardar la nueva contraseña
// POST /api/reset-password
// Body: { token: "xxx", password: "nueva" }
// ============================================
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token y contraseña son requeridos' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    // ⚠️ Buscar el usuario por el token y verificar que no haya expirado
    // Ejemplo:
    // const user = await db.query(
    //   'SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()',
    //   [token]
    // );

    // if (!user) {
    //   return res.status(400).json({ error: 'Token inválido o expirado' });
    // }

    // Hashear la nueva contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // ⚠️ Actualizar la contraseña y limpiar el token
    // await db.query(
    //   'UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
    //   [hashedPassword, user.id]
    // );

    res.json({ message: 'Contraseña actualizada correctamente' });

  } catch (error) {
    console.error('Error en reset-password:', error);
    res.status(500).json({ error: 'Error al actualizar la contraseña' });
  }
});

module.exports = router;
