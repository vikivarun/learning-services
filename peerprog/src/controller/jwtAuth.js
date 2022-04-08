const router = require('express').Router();
const { pool } = require('../dao');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { jwtGenerator, jwtAccessGenerator } = require('../utils/jwtGenerator');
const { ROLE_CODE, ROLE_NAME } = require('../config/userRoleCode');
const sendVerificationcode = require('./verification');
const {
  updateRefreshToken,
  findUser,
  findUserWithRefreshToken,
  findUserWithId
} = require('../utils/helper');
const { deleteSensitive } = require('../utils/utility');

// // registering
exports.register = async (req, res) => {
  try {
    // 1. destructor thr req.body (name,email,password)
    const { name, email, password, rememberMe, eSign, currentStep } = req.body;
    if (!name) return res.status(400).json({ message: 'username is required' });
    if (!password || !email)
      return res
        .status(400)
        .json({ message: 'Email and Password is required' });
    if (!eSign) return res.status(400).json({ message: 'missing E-sign' });

    // 2. check if user exists (throw error if exists)
    const user = await findUser(email);
    if (user.rows.length !== 0) {
      return res
        .status(409)
        .json({ message: 'User already exists with this Email' });
    }

    //  3. bcrypt the user password
    const saltRound = 10;
    const salt = await bcrypt.genSalt(saltRound);
    const bcryptPassword = await bcrypt.hash(password, salt);

    // 5. generating the jwt token
    const expiry = rememberMe ? '14d' : '1d';
    const { access_token, refresh_token } = jwtGenerator(email, expiry);

    const nextStep = currentStep + 1;

    // 4. enter the user inside our database
    const newUser = await pool.query(
      'INSERT INTO "USERS"("NAME", "EMAIL", "PASSWORD", "REFRESH_TOKEN","ORG_ID","ROLE","IS_REGISTERED","ROLE_CODE","E_SIGN", "CURRENT_STEP") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
      [
        name,
        email,
        bcryptPassword,
        refresh_token,
        1,
        ROLE_NAME.INCOMPLETE_PROFILE,
        false,
        ROLE_CODE.INCOMPLETE_PROFILE,
        eSign,
        nextStep
      ]
    );

    const userData = deleteSensitive(newUser);

    const expiryDays = rememberMe ? 14 : 1;
    res.cookie('refresh_token', refresh_token, {
      httpOnly: true,
      maxAge: expiryDays * 24 * 60 * 60 * 1000,
      sameSite: 'None',
      secure: true
    });
    const id = userData.ID;

    const message = sendVerificationcode({ id, email });

    res.status(201).json({
      otpStatus: message,
      message: `New user ${name} created successfully`,
      token: access_token,
      refresh_token: refresh_token,
      userInfo: userData
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// login route
exports.login = async (req, res) => {
  try {
    // 1. destructor thr req.body (name,email,password)
    const { email, password, rememberMe } = req.body;

    if (!password || !email)
      return res
        .status(400)
        .json({ message: 'Email and Password is required' });

    // 2. check if user exists (throw error if not exists)
    const user = await findUser(email);

    if (user.rows.length === 0) {
      return res
        .status(401)
        .json({ message: 'Password or Email is incorrect' });
    }

    //  3. check if incoming password is same as the db password
    const validPassword = await bcrypt.compare(password, user.rows[0].PASSWORD);
    if (!validPassword) {
      return res
        .status(401)
        .json({ message: 'Password or Email is incorrect' });
    }

    // 4. return jwt token
    const expiry = rememberMe ? '14d' : '1d';
    const { access_token, refresh_token } = jwtGenerator(email, expiry);

    const expiryDays = rememberMe ? 14 : 1;
    res.cookie('refresh_token', refresh_token, {
      httpOnly: true,
      maxAge: expiryDays * 24 * 60 * 60 * 1000,
      sameSite: 'None',
      secure: true
    });
    // 5. update refresh tokens
    await updateRefreshToken(refresh_token, user.rows[0].ID);

    const userData = deleteSensitive(user);

    res.json({
      token: access_token,
      userInfo: userData
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// // verify
exports.authorize = (req, res) => {
  try {
    res.json(true);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};
exports.isAuthenticated = async (req, res) => {
  try {
    const cookies = req.cookies;

    if (!cookies?.refresh_token) return res.sendStatus(401);

    const refresh_token = cookies.refresh_token;

    const foundUser = await findUserWithRefreshToken(refresh_token);

    if (foundUser.rowCount === 0) return res.sendStatus(403);

    jwt.verify(
      refresh_token,
      process.env.JWT_REFRESH_TOKEN,
      async (error, payload) => {
        if (error || payload.user !== foundUser.rows[0].EMAIL)
          return res.sendStatus(403);

        res.json({ isAuthenticated: true });
      }
    );
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

exports.refreshToken = async (req, res) => {
  const cookies = req.cookies;
  try {
    if (!cookies?.refresh_token) return res.sendStatus(401);

    const refresh_token = cookies.refresh_token;

    const foundUser = await findUserWithRefreshToken(refresh_token);

    if (foundUser.rowCount === 0) return res.sendStatus(403);

    jwt.verify(
      refresh_token,
      process.env.JWT_REFRESH_TOKEN,
      async (error, payload) => {
        if (error || payload.user !== foundUser.rows[0].EMAIL)
          return res.sendStatus(403);

        const newToken = jwtAccessGenerator(payload.user);

        const userData = deleteSensitive(foundUser);

        res.json({ token: newToken.access_token, userInfo: userData });
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// // refresh your access token here
exports.logout = async (req, res) => {
  try {
    const cookies = req.cookies;

    if (!cookies?.refresh_token) return res.sendStatus(204);

    const refresh_token = cookies.refresh_token;

    const foundUser = await findUserWithRefreshToken(refresh_token);

    if (foundUser.rowCount === 0) {
      res.clearCookie('refresh_token', {
        httpOnly: true,
        sameSite: 'None',
        secure: true
      });
      res.sendStatus(204);
    }

    await pool.query(
      'UPDATE "USERS" SET "REFRESH_TOKEN" = null WHERE "ID" = $1',
      [foundUser.rows[0].ID]
    );

    res.clearCookie('refresh_token', {
      httpOnly: true,
      sameSite: 'None',
      secure: true
    });

    return res.status(204).json({ msg: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.verifyEmail = async (req, res) => {
  let { id, uniqueString, currentStep } = req.body;
  if (!id) return res.status(400).json({ message: 'user id is missing' });
  try {
    const user = await findUserWithId(id);
    if (user.rowCount === 0)
      return res.status(403).json({
        message:
          "Account record doesn't exist or has been verified already. please sign up or login  "
      });
    const { EXPIRES_AT, OTP } = user.rows[0];

    if (EXPIRES_AT < Date.now()) {
      await pool.query('UPDATE "USERS" SET "OTP" = $1, "EXPIRES_AT" = $2', [
        null,
        null
      ]);
      return res.status(400).json({ message: 'Otp has been Expired' });
    }
    const validOtp = await bcrypt.compare(
      uniqueString.toString(),
      OTP.toString()
    );

    if (!validOtp) return res.status(400).json({ message: 'Otp is Incorrect' });

    const nextStep = currentStep + 1;

    const newUser = await pool.query(
      'UPDATE "USERS" SET "OTP" = $1, "EXPIRES_AT" = $2, "VERIFIED" = $3, "CURRENT_STEP" = $4 WHERE "ID" = $5 RETURNING *',
      [null, null, true, nextStep, id]
    );
    res.status(200).json({ verified: true, userInfo: newUser.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
