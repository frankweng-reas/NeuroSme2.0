# certs/ — SSL 憑證存放目錄

此目錄用於存放 SSL 憑證（**模式 A：自備憑證**）。

## 需要的檔案

| 檔案名稱 | 說明 |
|---------|------|
| `cert.pem` | SSL 憑證，需包含**完整憑證鏈**（leaf certificate + intermediate CA） |
| `key.pem` | 私鑰（Private Key） |

## 取得憑證的方式

- 向公司 IT / 資安部門申請（公司內部 CA 簽發）
- 向 SSL 憑證廠商購買（DigiCert、GlobalSign 等）
- 若為測試環境，可使用 self-signed 憑證（瀏覽器會顯示警告）

## 注意事項

- `cert.pem` 若未包含完整憑證鏈，部分瀏覽器可能顯示憑證錯誤。通常憑證供應商會提供 `fullchain.pem`，直接重新命名為 `cert.pem` 即可。
- 憑證到期後，替換這兩個檔案並執行以下指令重新載入：

```bash
docker compose -f docker-compose.onprem.yml restart caddy
```

## 使用模式 B（Let's Encrypt 自動申請）

若您的伺服器有公開 domain 且可連外網，可改用模式 B，**不需要放任何憑證檔案**。
請參閱 `Caddyfile` 內的說明切換設定。
