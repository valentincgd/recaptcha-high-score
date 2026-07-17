use once_cell::sync::Lazy;
use rustc_hash::FxHashMap;

#[derive(Copy, Clone)]
pub enum Opcode {
    LoadConst,
    JumpIfEq,
    StrToBytes,
    Xor,
    Mod,
    Add,
    Sub,
    Mul,
    Or,
    Div,
    Not,
    StrDec,
    GetWindowProp,
    GetProp,
    CallMethod,
    Regexp,
    Perf,
    MathTrunc,
    BindApply,
    CallWindowProp,
    SetProp,
    SetWindowProp,
    JumpIfLt,
    NewFunction,
    Disposer,
    Concat,
    Apply,
    Mov,
    Hash,
    SerialToStr,
    UnknownOp,
    UnknownBinOp,
    Typeof,
    Jmp,
    LoadImm,
    Null,
    Send,
}

impl Opcode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Opcode::LoadConst => "LOAD_CONST",
            Opcode::JumpIfEq => "JE",
            Opcode::StrToBytes => "STR_TO_B",
            Opcode::Xor => "XOR",
            Opcode::Mod => "MOD",
            Opcode::Add => "ADD",
            Opcode::Sub => "SUB",
            Opcode::Mul => "MUL",
            Opcode::Or => "OR",
            Opcode::Div => "DIV",
            Opcode::Not => "NOT",
            Opcode::StrDec => "STR_DEC",
            Opcode::GetWindowProp => "GET_WINDOW_PROP",
            Opcode::GetProp => "GET_PROP",
            Opcode::CallMethod => "CALL_METHOD",
            Opcode::Regexp => "REGEXP",
            Opcode::Perf => "PERF",
            Opcode::MathTrunc => "MATH_TRUNC",
            Opcode::BindApply => "BIND_APPLY",
            Opcode::CallWindowProp => "CALL_WINDOW_PROP",
            Opcode::SetProp => "SET_PROP",
            Opcode::SetWindowProp => "SET_WINDOW_PROP",
            Opcode::JumpIfLt => "JL",
            Opcode::NewFunction => "NEW_FUNCTION",
            Opcode::Disposer => "DISPOSER",
            Opcode::Concat => "CONCAT",
            Opcode::Apply => "APPLY",
            Opcode::Mov => "MOV",
            Opcode::Hash => "HASH",
            Opcode::SerialToStr => "SERIAL_TO_STR",
            Opcode::UnknownOp => "UNKNOWN_OP",
            Opcode::UnknownBinOp => "UNKNOWN_BIN_OP",
            Opcode::Typeof => "TYPEOF",
            Opcode::LoadImm => "LOAD_IMM",
            Opcode::Null => "NULL",
            Opcode::Send => "SEND",
            Opcode::Jmp => "JMP",
        }
    }
}

pub static OPCODES_TABLE: Lazy<FxHashMap<u16, Opcode>> = Lazy::new(|| {
    let mut table = FxHashMap::default();

    table.insert(1, Opcode::LoadConst);
    table.insert(2, Opcode::Concat);
    table.insert(3, Opcode::Xor);
    table.insert(4, Opcode::CallMethod);
    table.insert(5, Opcode::GetProp);
    table.insert(6, Opcode::SetProp);
    table.insert(7, Opcode::Send);
    table.insert(8, Opcode::Mov);
    table.insert(9, Opcode::Null);
    table.insert(10, Opcode::Add);
    table.insert(11, Opcode::Sub);
    table.insert(12, Opcode::Mul);
    table.insert(13, Opcode::Div);
    table.insert(14, Opcode::UnknownOp);
    table.insert(15, Opcode::Mod);
    table.insert(16, Opcode::SetWindowProp);
    table.insert(17, Opcode::GetWindowProp);
    table.insert(18, Opcode::CallWindowProp);
    table.insert(19, Opcode::JumpIfEq);
    table.insert(20, Opcode::Hash);
    table.insert(21, Opcode::StrToBytes);
    table.insert(22, Opcode::Regexp);
    table.insert(23, Opcode::UnknownBinOp);
    table.insert(24, Opcode::UnknownBinOp);
    table.insert(25, Opcode::Not);
    table.insert(27, Opcode::SerialToStr);
    table.insert(28, Opcode::MathTrunc);
    table.insert(30, Opcode::NewFunction);
    table.insert(31, Opcode::JumpIfLt);
    table.insert(32, Opcode::Disposer);
    table.insert(34, Opcode::BindApply);
    table.insert(35, Opcode::Or);
    table.insert(36, Opcode::StrDec);
    table.insert(38, Opcode::Apply);
    table.insert(39, Opcode::Perf);
    table.insert(40, Opcode::LoadImm);
    table.insert(41, Opcode::Typeof);

    table
});
