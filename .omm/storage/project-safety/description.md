Detects suspicious saves, stores healthy snapshots and quarantine records, mirrors backups to JSON files, and supports restoration after crashes or corruption.

Cloud-project upload preparation has a separate, currently unconnected safety guard. It removes known credential fields and rejects unprepared media and suspicious secret-bearing content; it does not alter local backups and is not a complete guarantee against secrets in free text. Cloud sync remains disabled until media preparation, server recovery, authentication, and end-to-end verification are complete.
