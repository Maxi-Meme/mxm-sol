
-
-- Tools → Options → Query Results → SQL Server → Results to Text // set to large  # of chars
-- New Query Window, then:
--
select CAST(api_auto_migrate_log AS VARCHAR(MAX))from keypair where publickey = 'BgoARWJa6WmDpqADs2KkxbRRZTjvoHTioUm5tnbpmaxi' 
