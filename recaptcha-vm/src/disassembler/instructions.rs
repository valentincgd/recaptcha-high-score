use super::Value;
use std::fmt;

#[derive(Debug, Clone)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Xor,
    Or,
    Unknown,
}

#[derive(Clone)]
pub enum Instruction {
    LoadConst(LoadConstInstruction),
    JumpIfEq(JumpIfEqInstruction),
    StrToBytes(StrToBytesInstruction),
    Binary(BinaryInstruction),
    StrDec(StrDecInstruction),
    GetWindowProp(GetWindowPropInstruction),
    CallMethod(CallMethodInstruction),
    GetProp(GetPropInstruction),
    SetProp(SetPropInstruction),
    Null(NullInstruction),
    Regexp(RegexpInstruction),
    Mov(MovInstruction),
    Apply(ApplyInstruction),
    Perf(PerfInstruction),
    MathTrunc(MathTruncInstruction),
    BindApply(BindApplyInstruction),
    NewFunction(NewFunctionInstruction),
    CallWindowProp(CallWindowPropInstruction),
    JumpIfLt(JumpIfLtInstruction),
    Disposer(DisposerInstruction),
    Concat(ConcatInstruction),
    SetWindowProp(SetWindowPropInstruction),
    Hash(HashInstruction),
    SerialToStr(SerialToStrInstruction),
    UnknownOp(UnknownOpInstruction),
    Not(NotInstruction),
    Send(SendInstruction),
    Typeof(TypeofInstruction),
    Jump(JumpInstruction),
}

macro_rules! impl_from_instruction {
    ($($variant:ident => $ty:ty),* $(,)?) => {
        $(
            impl From<$ty> for Instruction {
                fn from(v: $ty) -> Self {
                    Instruction::$variant(v)
                }
            }
        )*
    };
}

impl_from_instruction! {
    LoadConst => LoadConstInstruction,
    JumpIfEq => JumpIfEqInstruction,
    StrToBytes => StrToBytesInstruction,
    Binary => BinaryInstruction,
    StrDec => StrDecInstruction,
    GetWindowProp => GetWindowPropInstruction,
    CallMethod => CallMethodInstruction,
    GetProp => GetPropInstruction,
    SetProp => SetPropInstruction,
    Null => NullInstruction,
    Regexp => RegexpInstruction,
    Mov => MovInstruction,
    Apply => ApplyInstruction,
    Perf => PerfInstruction,
    MathTrunc => MathTruncInstruction,
    BindApply => BindApplyInstruction,
    NewFunction => NewFunctionInstruction,
    CallWindowProp => CallWindowPropInstruction,
    JumpIfLt => JumpIfLtInstruction,
    Disposer => DisposerInstruction,
    Concat => ConcatInstruction,
    SetWindowProp => SetWindowPropInstruction,
    Hash => HashInstruction,
    SerialToStr => SerialToStrInstruction,
    UnknownOp => UnknownOpInstruction,
    Not => NotInstruction,
    Send => SendInstruction,
    Typeof => TypeofInstruction,
    Jump => JumpInstruction,
}

#[macro_export]
macro_rules! emit {
    ($self:expr, $name:expr, $offset:expr, $instruction:expr) => {{
        use $crate::disassembler::instructions::IntoDisplay;
        let base = $instruction.display($offset, $name);

        if $self.show_instructions {
            println!("{}", base);
        }

        $self
            .instructions
            .push(base.map_inner::<$crate::disassembler::instructions::Instruction>());
    }};
}

#[derive(Debug, Clone)]
pub struct InstructionBase<T> {
    pub offset: usize,
    pub name: String,
    pub inner: T,
}

impl<T> InstructionBase<T> {
    pub fn map_inner<U: From<T>>(self) -> InstructionBase<U> {
        InstructionBase {
            offset: self.offset,
            name: self.name,
            inner: self.inner.into(),
        }
    }
}

pub trait IntoDisplay: Sized {
    fn display(self, offset: usize, name: &str) -> InstructionBase<Self> {
        InstructionBase {
            offset,
            name: name.to_string(),
            inner: self,
        }
    }
}

impl<T> IntoDisplay for T {}

impl fmt::Display for InstructionBase<Instruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        macro_rules! delegate {
            ($i:expr) => {
                InstructionBase {
                    offset: self.offset,
                    name: self.name.clone(),
                    inner: $i.clone(),
                }
                .fmt(f)
            };
        }
        match &self.inner {
            Instruction::LoadConst(i) => delegate!(i),
            Instruction::JumpIfEq(i) => delegate!(i),
            Instruction::StrToBytes(i) => delegate!(i),
            Instruction::Binary(i) => delegate!(i),
            Instruction::StrDec(i) => delegate!(i),
            Instruction::GetWindowProp(i) => delegate!(i),
            Instruction::CallMethod(i) => delegate!(i),
            Instruction::GetProp(i) => delegate!(i),
            Instruction::SetProp(i) => delegate!(i),
            Instruction::Null(i) => delegate!(i),
            Instruction::Regexp(i) => delegate!(i),
            Instruction::Mov(i) => delegate!(i),
            Instruction::Apply(i) => delegate!(i),
            Instruction::Perf(i) => delegate!(i),
            Instruction::MathTrunc(i) => delegate!(i),
            Instruction::BindApply(i) => delegate!(i),
            Instruction::NewFunction(i) => delegate!(i),
            Instruction::CallWindowProp(i) => delegate!(i),
            Instruction::JumpIfLt(i) => delegate!(i),
            Instruction::Disposer(i) => delegate!(i),
            Instruction::Concat(i) => delegate!(i),
            Instruction::SetWindowProp(i) => delegate!(i),
            Instruction::Hash(i) => delegate!(i),
            Instruction::SerialToStr(i) => delegate!(i),
            Instruction::UnknownOp(i) => delegate!(i),
            Instruction::Not(i) => delegate!(i),
            Instruction::Send(i) => delegate!(i),
            Instruction::Typeof(i) => delegate!(i),
            Instruction::Jump(i) => delegate!(i),
        }
    }
}

#[derive(Debug, Clone)]
pub struct LoadConstInstruction {
    // dest = value;
    pub dest: u16,
    pub value: Value,
}

#[derive(Debug, Clone)]
pub struct JumpIfEqInstruction {
    // if (lhs == rhs) { goto target }
    pub rhs: Value,
    pub lhs: Value,
    pub target: i32,
}

#[derive(Debug, Clone)]
pub struct StrToBytesInstruction {
    // dest = str_to_bytes(value)
    pub dest: u16,
    pub value: Value,
}

#[derive(Debug, Clone)]
pub struct BinaryInstruction {
    // dest = lhs op rhs
    pub op: BinOp,
    pub dest: u16,
    pub rhs: Value,
    pub lhs: Value,
}

#[derive(Debug, Clone)]
pub struct StrDecInstruction {
    // dest = string
    pub dest: u16,
    pub string: String,
}

#[derive(Debug, Clone)]
pub struct GetWindowPropInstruction {
    // dest = window[prop]
    pub dest: u16,
    pub prop: Value,
}

#[derive(Debug, Clone)]
pub struct CallMethodInstruction {
    // dest = function[method](args)
    pub dest: u16,
    pub function: Value,
    pub method: Value,
    pub args: Vec<u16>,
}

#[derive(Debug, Clone)]
pub struct GetPropInstruction {
    // dest = obj[prop]
    pub dest: u16,
    pub obj: Value,
    pub prop: Value,
}

#[derive(Debug, Clone)]
pub struct SetPropInstruction {
    // obj[prop] = value
    pub obj: Value,
    pub prop: Value,
    pub value: Value,
}

#[derive(Debug, Clone)]
pub struct NullInstruction {
    // dest = null
    pub dest: u16,
}

#[derive(Debug, Clone)]
pub struct RegexpInstruction {
    // dest = new RegExp(pattern, flags)
    pub dest: u16,
    pub pattern: Value,
    pub flags: Value,
}

#[derive(Debug, Clone)]
pub struct MovInstruction {
    // dest = value
    pub dest: u16,
    pub value: Value,
}

#[derive(Debug, Clone)]
pub struct ApplyInstruction {
    // dest = function.apply(null, args)
    pub dest: u16,
    pub function: Value,
    pub args: Vec<u16>,
}

#[derive(Debug, Clone)]
pub struct PerfInstruction {
    // dest = performance.now()
    pub dest: u16,
}

#[derive(Debug, Clone)]
pub struct MathTruncInstruction {
    // dest = Math.trunc(performance.now())
    pub dest: u16,
}

#[derive(Debug, Clone)]
pub struct BindApplyInstruction {
    // dest = new (Function.prototype.bind.apply(thisValue, [null].concat(args)))
    pub dest: u16,
    pub this: Value,
    pub args: Vec<u16>,
}

#[derive(Debug, Clone)]
pub struct NewFunctionInstruction {
    // dest = function(args_reg) { target } // is only arg
    pub dest: u16,
    pub args_reg: u16,
    pub target: i32,
}

#[derive(Debug, Clone)]
pub struct CallWindowPropInstruction {
    // dest = window[prop].apply(window, args)
    pub dest: u16,
    pub prop: Value,
    pub args: Vec<u16>,
}

#[derive(Debug, Clone)]
pub struct JumpIfLtInstruction {
    // if (lhs < rhs) { target }
    pub rhs: Value,
    pub lhs: Value,
    pub target: i32,
}

#[derive(Debug, Clone)]
// 0x00472d:  DISPOSER     R905, 0x008399
/*
* 0x008399:  STR_TO_B          R845, R452
0x0083a3:  XOR               R845, R845 ^ R341
0x0083b2:  MOD               R845, R845 % R438
0x0083c1:  STR_DEC           R845, "document"
0x0083d0:  GET_WINDOW_PROP   R845, R845
0x0083da:  STR_TO_B          R564, R181
0x0083e4:  XOR               R564, R564 ^ R341
0x0083f3:  MOD               R564, R564 % R438
0x008402:  STR_DEC           R564, "body"
0x008411:  GET_PROP          R845, R845[R564]
0x008420:  STR_TO_B          R978, R541
0x00842a:  XOR               R978, R978 ^ R341
0x008439:  MOD               R978, R978 % R438
0x008448:  STR_DEC           R978, "removeEventListener"
0x008457:  STR_TO_B          R1277, R1550
0x008461:  XOR               R1277, R1277 ^ R341
0x008470:  MOD               R1277, R1277 % R438
0x00847f:  STR_DEC           R1277, "pointerdown"
0x00848e:  CALL_METHOD       R564, R845, method=R978, args=[R1277, R849]
0x0084a7:  STR_TO_B          R1277, R889
0x0084b1:  XOR               R1277, R1277 ^ R341
0x0084c0:  MOD               R1277, R1277 % R438
0x0084cf:  STR_DEC           R1277, "pointerup"
0x0084de:  CALL_METHOD       R564, R845, method=R978, args=[R1277, R1056]
0x0084f7:  STR_TO_B          R1277, R1862
0x008501:  XOR               R1277, R1277 ^ R341
0x008510:  MOD               R1277, R1277 % R438
0x00851f:  STR_DEC           R1277, "pointermove"
0x00852e:  CALL_METHOD       R564, R845, method=R978, args=[R1277, R581]
0x008547:  NULL              R845
0x00854c:  NULL              R978
0x008551:  NULL              R1277
0x008556:  NULL              R564
0x00855b:  JMP               0x013301
*/
pub struct DisposerInstruction {
    pub func_reg: u16,
    pub target: i32,
}

#[derive(Debug, Clone)]
pub struct ConcatInstruction {
    // dest = lhs + rhs
    pub dest: u16,
    pub lhs: Value,
    pub rhs: Value,
}

#[derive(Debug, Clone)]
pub struct SetWindowPropInstruction {
    // window[prop] = value
    pub prop: Value,
    pub value: Value,
}

#[derive(Debug, Clone)]
pub struct HashInstruction {
    // dest = hash(seed, value)
    pub dest: u16,
    pub seed: Value,
    pub value: Value,
}

#[derive(Debug, Clone)]
pub struct SerialToStrInstruction {
    // dest = "" + value
    pub dest: u16,
    pub value: Value,
}

#[derive(Debug, Clone)]
pub struct UnknownOpInstruction {
    pub value: Value,
}

#[derive(Debug, Clone)]
pub struct NotInstruction {
    // dest = !value
    pub dest: u16,
    pub value: Value,
}

#[derive(Debug, Clone)]
pub struct SendInstruction {
    // send(values)
    pub values: Vec<u16>,
}

#[derive(Debug, Clone)]
pub struct TypeofInstruction {
    // dest = typeof value
    pub dest: u16,
    pub value: Value,
}

#[derive(Debug, Clone)]
pub struct JumpInstruction {
    pub target: i32,
}

impl fmt::Display for InstructionBase<LoadConstInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, {}",
            self.offset, self.name, self.inner.dest, self.inner.value,
        )
    }
}

impl fmt::Display for InstructionBase<JumpIfEqInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} {} == {}, 0x{:06x}",
            self.offset, self.name, self.inner.lhs, self.inner.rhs, self.inner.target,
        )
    }
}

impl fmt::Display for InstructionBase<StrToBytesInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, {}",
            self.offset, self.name, self.inner.dest, self.inner.value,
        )
    }
}

impl fmt::Display for InstructionBase<BinaryInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let op = match self.inner.op {
            BinOp::Add => "+",
            BinOp::Sub => "-",
            BinOp::Mul => "*",
            BinOp::Div => "/",
            BinOp::Mod => "%",
            BinOp::Xor => "^",
            BinOp::Or => "|",
            BinOp::Unknown => "?",
        };
        write!(
            f,
            "0x{:06x}:  {:<17} R{}, {} {} {}",
            self.offset, self.name, self.inner.dest, self.inner.lhs, op, self.inner.rhs
        )
    }
}

impl fmt::Display for InstructionBase<StrDecInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r#"0x{:06x}:  {:<17} R{}, "{}""#,
            self.offset, self.name, self.inner.dest, self.inner.string,
        )
    }
}
impl fmt::Display for InstructionBase<GetWindowPropInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, {}",
            self.offset, self.name, self.inner.dest, self.inner.prop,
        )
    }
}

impl fmt::Display for InstructionBase<CallMethodInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let args = self
            .inner
            .args
            .iter()
            .map(|r| format!("R{}", r))
            .collect::<Vec<_>>()
            .join(", ");

        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, {}, method={}, args=[{}]",
            self.offset, self.name, self.inner.dest, self.inner.function, self.inner.method, args,
        )
    }
}

impl fmt::Display for InstructionBase<GetPropInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, {}[{}]",
            self.offset, self.name, self.inner.dest, self.inner.obj, self.inner.prop,
        )
    }
}

impl fmt::Display for InstructionBase<SetPropInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} {}[{}], {}",
            self.offset, self.name, self.inner.obj, self.inner.prop, self.inner.value,
        )
    }
}

impl fmt::Display for InstructionBase<NullInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}",
            self.offset, self.name, self.inner.dest
        )
    }
}

impl fmt::Display for InstructionBase<RegexpInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, pattern={}, flags={}",
            self.offset, self.name, self.inner.dest, self.inner.pattern, self.inner.flags,
        )
    }
}

impl fmt::Display for InstructionBase<MovInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, {}",
            self.offset, self.name, self.inner.dest, self.inner.value,
        )
    }
}

impl fmt::Display for InstructionBase<ApplyInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let args = self
            .inner
            .args
            .iter()
            .map(|r| format!("R{}", r))
            .collect::<Vec<_>>()
            .join(", ");

        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, {}, args=[{}]",
            self.offset, self.name, self.inner.dest, self.inner.function, args,
        )
    }
}

impl fmt::Display for InstructionBase<PerfInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}",
            self.offset, self.name, self.inner.dest
        )
    }
}

impl fmt::Display for InstructionBase<MathTruncInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}",
            self.offset, self.name, self.inner.dest
        )
    }
}

impl fmt::Display for InstructionBase<BindApplyInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let args = self
            .inner
            .args
            .iter()
            .map(|r| format!("R{}", r))
            .collect::<Vec<_>>()
            .join(", ");

        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, this={}, args=[{}]",
            self.offset, self.name, self.inner.dest, self.inner.this, args,
        )
    }
}

impl fmt::Display for InstructionBase<NewFunctionInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, args=R{}, 0x{:06x}",
            self.offset, self.name, self.inner.dest, self.inner.args_reg, self.inner.target
        )
    }
}

impl fmt::Display for InstructionBase<CallWindowPropInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let args = self
            .inner
            .args
            .iter()
            .map(|r| format!("R{}", r))
            .collect::<Vec<_>>()
            .join(", ");

        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, {}, args=[{}]",
            self.offset, self.name, self.inner.dest, self.inner.prop, args,
        )
    }
}

impl fmt::Display for InstructionBase<JumpIfLtInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} {} < {}, 0x{:06x}",
            self.offset, self.name, self.inner.lhs, self.inner.rhs, self.inner.target,
        )
    }
}

impl fmt::Display for InstructionBase<DisposerInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, 0x{:06x}",
            self.offset, self.name, self.inner.func_reg, self.inner.target,
        )
    }
}

impl fmt::Display for InstructionBase<ConcatInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, {}, {}",
            self.offset, self.name, self.inner.dest, self.inner.lhs, self.inner.rhs,
        )
    }
}

impl fmt::Display for InstructionBase<SetWindowPropInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, R{}",
            self.offset, self.name, self.inner.prop, self.inner.value,
        )
    }
}

impl fmt::Display for InstructionBase<HashInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, {}, seed={}",
            self.offset, self.name, self.inner.dest, self.inner.value, self.inner.seed,
        )
    }
}

impl fmt::Display for InstructionBase<SerialToStrInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, {}",
            self.offset, self.name, self.inner.dest, self.inner.value,
        )
    }
}

impl fmt::Display for InstructionBase<UnknownOpInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} {}",
            self.offset, self.name, self.inner.value,
        )
    }
}

impl fmt::Display for InstructionBase<NotInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, {}",
            self.offset, self.name, self.inner.dest, self.inner.value,
        )
    }
}

impl fmt::Display for InstructionBase<SendInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let values = self
            .inner
            .values
            .iter()
            .map(|r| format!("R{}", r))
            .collect::<Vec<_>>()
            .join(", ");

        write!(f, r"0x{:06x}:  {:<17} {}", self.offset, self.name, values,)
    }
}

impl fmt::Display for InstructionBase<TypeofInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} R{}, {}",
            self.offset, self.name, self.inner.dest, self.inner.value,
        )
    }
}

impl fmt::Display for InstructionBase<JumpInstruction> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            r"0x{:06x}:  {:<17} 0x{:06x}",
            self.offset, self.name, self.inner.target,
        )
    }
}
