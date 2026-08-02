# ---- Dependencies ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

# ---- Builder ----
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The login gate runs in Edge middleware, whose env is frozen at BUILD time — it
# does NOT re-read process.env at runtime. The signing secret must therefore be
# present here so the middleware can verify session cookies, and it must ALSO be
# supplied at runtime so the Node login route signs with the identical value. A
# mismatch between the two means every session fails verification silently.
ARG AUTH_SECRET
ENV AUTH_SECRET=$AUTH_SECRET
RUN npm run build

# ---- Runner ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as the image's built-in unprivileged `node` user (uid 1000), never root.
# The original compromise dropped root-owned malware because this stage ran as
# root; an unprivileged runtime keeps an app-level RCE from becoming root on the
# container filesystem.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# The persistent data volume (USER_STORE, CONTACT_LOG) mounts at /data. Since the
# runtime is the unprivileged `node` user, it must own this path — otherwise the
# user store and contact log fail to write with EACCES. Docker copies this
# directory's ownership onto a *fresh, empty* named volume on first mount, so
# creating it node-owned here keeps new deploys writable. (An already-created,
# root-owned volume must be chowned on the host once — it won't be re-inherited.)
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000
CMD ["node", "server.js"]
