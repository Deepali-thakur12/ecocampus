SET DEFINE OFF
SET SERVEROUTPUT ON
WHENEVER SQLERROR EXIT SQL.SQLCODE

PROMPT Installing EcoCampus database objects...
@@schema.sql
@@routines.sql
@@seed.sql

PROMPT EcoCampus installation complete.
