FROM node:20-alpine AS builder

WORKDIR /app

ARG VITE_API_URL=
ARG VITE_AUTH_PASSWORD_ENABLED=true
ARG VITE_AUTH_GOOGLE_ENABLED=true
ARG VITE_GOOGLE_CLIENT_ID=

ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_AUTH_PASSWORD_ENABLED=${VITE_AUTH_PASSWORD_ENABLED}
ENV VITE_AUTH_GOOGLE_ENABLED=${VITE_AUTH_GOOGLE_ENABLED}
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package-lock.json ./apps/web/

RUN npm ci

COPY . .

RUN npm --workspace apps/web run build

FROM nginx:alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
