usage() {
  printf '\033[33m%s\033[0m\n' "Please provide a migration name."
  printf '\033[33m%s\033[0m\n' "Usage: npm run db:generate <migration_name>"
  printf '\n'
}

MIGRATION_NAME="$1"

if [[ "$MIGRATION_NAME" == "" ]]; then
  usage
  exit 1
fi


drizzle-kit generate --name "$MIGRATION_NAME"
