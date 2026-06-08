import { logError } from "@/lib/log";

// supabase-js errors (PostgrestError + RPC) share these two fields.
interface DbErrorLike {
  code?: string;
  message?: string;
}

/**
 * Map a raw DB/RPC error to a generic client code, logging detail server-side
 * (returning `error.message` verbatim leaks schema internals). The fallback;
 * action-specific codes are handled before reaching here.
 */
export function mapDbError(error: DbErrorLike, context: string): string {
  logError(`[db] ${context}`, error);

  switch (error.code) {
    case "23505": // unique_violation
    case "23503": // foreign_key_violation
    case "23514": // check_violation
      return "conflict";
    case "22P02": // invalid_text_representation
    case "22003": // numeric_value_out_of_range
      return "invalid_input";
    default:
      return "something_went_wrong";
  }
}
