FROM node:20-alpine

WORKDIR /app

# ビルドツールをインストール（better-sqlite3のネイティブビルドに必要）
RUN apk add --no-cache python3 make g++

# 依存関係をインストール
COPY package*. json ./
RUN npm install --production

# アプリケーションファイルをコピー
COPY . .

# データディレクトリを作成
RUN mkdir -p /app/data

CMD ["node", "bot.js"]
