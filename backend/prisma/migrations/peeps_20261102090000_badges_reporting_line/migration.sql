-- Peeps D-36: badges follow the reporting line. Two new giver kinds, recorded on each award (the existing rows keep theirs). Additive.
ALTER TYPE "RecognitionGiverKind" ADD VALUE IF NOT EXISTS 'DOWNWARD';
ALTER TYPE "RecognitionGiverKind" ADD VALUE IF NOT EXISTS 'UPWARD';
