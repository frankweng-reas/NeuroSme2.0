FROM pgvector/pgvector:pg16

# pg_cjk_parser：繁體中文全文搜尋（2-gram 切法），預編譯於 postgres:16/amd64
COPY pg_cjk_parser.so /usr/lib/postgresql/16/lib/
COPY pg_cjk_parser.control /usr/share/postgresql/16/extension/
COPY pg_cjk_parser--0.0.1.sql /usr/share/postgresql/16/extension/
COPY pg_cjk_parser--0.0.1--0.1.0.sql /usr/share/postgresql/16/extension/
COPY pg_cjk_parser--0.1.0.sql /usr/share/postgresql/16/extension/
