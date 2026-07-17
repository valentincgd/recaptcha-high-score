use crate::disassembler::{Value, instructions::*};
use swc_core::common::{DUMMY_SP, SyntaxContext};
use swc_core::ecma::ast::*;
use swc_core::ecma::atoms::{Atom, Wtf8Atom};

pub fn value_expr(val: &Value) -> Box<Expr> {
    match val {
        Value::Integer(i) => num_lit(*i as f64),
        Value::Float(f) => num_lit(*f),
        Value::String(s) => str_lit(s),
        Value::Boolean(b) => bool_lit(*b),
        Value::Register(r) => reg_expr(*r),
        Value::Undefined => Box::new(Expr::Ident(Ident::new_no_ctxt(
            "undefined".into(),
            DUMMY_SP,
        ))),
        Value::CodePoints(_) => todo!("CodePoints value"), // ill leave it like this for now
    }
}

pub fn reg_ident(reg: u16) -> Ident {
    Ident::new_no_ctxt(format!("r{reg}").into(), DUMMY_SP)
}

pub fn reg_expr(reg: u16) -> Box<Expr> {
    Box::new(Expr::Ident(reg_ident(reg)))
}

pub fn num_lit(n: f64) -> Box<Expr> {
    Box::new(Expr::Lit(Lit::Num(Number {
        span: DUMMY_SP,
        value: n,
        raw: None,
    })))
}

pub fn str_lit(s: &str) -> Box<Expr> {
    Box::new(Expr::Lit(Lit::Str(Str {
        span: DUMMY_SP,
        value: Wtf8Atom::new(s),
        raw: None,
    })))
}

pub fn bool_lit(b: bool) -> Box<Expr> {
    Box::new(Expr::Lit(Lit::Bool(Bool {
        span: DUMMY_SP,
        value: b,
    })))
}

pub fn null_lit() -> Box<Expr> {
    Box::new(Expr::Lit(Lit::Null(Null { span: DUMMY_SP })))
}

/// dest = rhs
pub fn assign_stmt(dest: u16, rhs: Box<Expr>) -> Stmt {
    Stmt::Expr(ExprStmt {
        span: DUMMY_SP,
        expr: Box::new(Expr::Assign(AssignExpr {
            span: DUMMY_SP,
            op: AssignOp::Assign,
            left: AssignTarget::Simple(SimpleAssignTarget::Ident(BindingIdent {
                id: reg_ident(dest),
                type_ann: None,
            })),
            right: rhs,
        })),
    })
}

/// obj[prop] = rhs
pub fn assign_member_stmt(obj: Box<Expr>, prop: Box<Expr>, rhs: Box<Expr>) -> Stmt {
    Stmt::Expr(ExprStmt {
        span: DUMMY_SP,
        expr: Box::new(Expr::Assign(AssignExpr {
            span: DUMMY_SP,
            op: AssignOp::Assign,
            left: AssignTarget::Simple(SimpleAssignTarget::Member(MemberExpr {
                span: DUMMY_SP,
                obj,
                prop: MemberProp::Computed(ComputedPropName {
                    span: DUMMY_SP,
                    expr: prop,
                }),
            })),
            right: rhs,
        })),
    })
}

pub fn binary_expr(op: BinaryOp, left: Box<Expr>, right: Box<Expr>) -> Box<Expr> {
    Box::new(Expr::Bin(BinExpr {
        span: DUMMY_SP,
        op,
        left,
        right,
    }))
}

/// obj[prop]
pub fn computed_member(obj: Box<Expr>, prop: Box<Expr>) -> Box<Expr> {
    Box::new(Expr::Member(MemberExpr {
        span: DUMMY_SP,
        obj,
        prop: MemberProp::Computed(ComputedPropName {
            span: DUMMY_SP,
            expr: prop,
        }),
    }))
}

/// callee(args…)
pub fn call_expr(callee: Box<Expr>, args: Vec<Box<Expr>>) -> Box<Expr> {
    Box::new(Expr::Call(CallExpr {
        span: DUMMY_SP,
        callee: Callee::Expr(callee),
        args: args
            .into_iter()
            .map(|e| ExprOrSpread {
                spread: None,
                expr: e,
            })
            .collect(),
        type_args: None,
        ctxt: SyntaxContext::default(),
    }))
}

pub fn expr_stmt(expr: Box<Expr>) -> Stmt {
    Stmt::Expr(ExprStmt {
        span: DUMMY_SP,
        expr,
    })
}

// dest = value
pub fn lift_load_const(i: &LoadConstInstruction) -> Stmt {
    assign_stmt(i.dest, value_expr(&i.value))
}

// dest = str_to_bytes(value)

pub fn lift_str_to_bytes(i: &StrToBytesInstruction) -> Stmt {
    let callee = Box::new(Expr::Ident(Ident::new_no_ctxt(
        "__str_to_bytes".into(),
        DUMMY_SP,
    )));
    assign_stmt(i.dest, call_expr(callee, vec![value_expr(&i.value)]))
}

pub fn lift_str_dec(i: &StrDecInstruction) -> Stmt {
    assign_stmt(i.dest, str_lit(&i.string))
}

//  dest = lhs op rhs
pub fn lift_binary(i: &BinaryInstruction) -> Stmt {
    let lhs = value_expr(&i.lhs);
    let rhs = value_expr(&i.rhs);
    let expr: Box<Expr> = match i.op {
        BinOp::Add => binary_expr(BinaryOp::Add, lhs, rhs),
        BinOp::Sub => binary_expr(BinaryOp::Sub, lhs, rhs),
        BinOp::Mul => binary_expr(BinaryOp::Mul, lhs, rhs),
        BinOp::Div => binary_expr(BinaryOp::Div, lhs, rhs),
        BinOp::Mod => binary_expr(BinaryOp::Mod, lhs, rhs),
        BinOp::Xor => binary_expr(BinaryOp::BitXor, lhs, rhs),
        BinOp::Or => binary_expr(BinaryOp::BitOr, lhs, rhs),
        BinOp::Unknown => binary_expr(BinaryOp::BitAnd, lhs, rhs),
    };
    assign_stmt(i.dest, expr)
}

// dest = window[prop]
pub fn lift_get_window_prop(i: &GetWindowPropInstruction) -> Stmt {
    let window = Box::new(Expr::Ident(Ident::new_no_ctxt("window".into(), DUMMY_SP)));
    assign_stmt(i.dest, computed_member(window, value_expr(&i.prop)))
}

// window[prop] = value
pub fn lift_set_window_prop(i: &SetWindowPropInstruction) -> Stmt {
    let window = Box::new(Expr::Ident(Ident::new_no_ctxt("window".into(), DUMMY_SP)));
    assign_member_stmt(window, value_expr(&i.prop), value_expr(&i.value))
}

// dest = function[method](args…)
pub fn lift_call_method(i: &CallMethodInstruction) -> Stmt {
    let callee = computed_member(value_expr(&i.function), value_expr(&i.method));
    let args: Vec<Box<Expr>> = i.args.iter().map(|&r| reg_expr(r)).collect();
    assign_stmt(i.dest, call_expr(callee, args))
}

// dest = window[prop].apply(window, args)
pub fn lift_call_window_prop(i: &CallWindowPropInstruction) -> Stmt {
    let window = Box::new(Expr::Ident(Ident::new_no_ctxt("window".into(), DUMMY_SP)));
    let callee = computed_member(window, value_expr(&i.prop));
    let args: Vec<Box<Expr>> = i.args.iter().map(|&r| reg_expr(r)).collect();
    assign_stmt(i.dest, call_expr(callee, args))
}

// dest = obj[prop]
pub fn lift_get_prop(i: &GetPropInstruction) -> Stmt {
    assign_stmt(
        i.dest,
        computed_member(value_expr(&i.obj), value_expr(&i.prop)),
    )
}

// obj[prop] = value
pub fn lift_set_prop(i: &SetPropInstruction) -> Stmt {
    assign_member_stmt(
        value_expr(&i.obj),
        value_expr(&i.prop),
        value_expr(&i.value),
    )
}

pub fn lift_null(i: &NullInstruction) -> Stmt {
    assign_stmt(i.dest, null_lit())
}

// dest = new RegExp(pattern, flags)
pub fn lift_regexp(i: &RegexpInstruction) -> Stmt {
    match (&i.pattern, &i.flags) {
        (Value::String(pat), Value::String(flags)) => {
            let regex = Box::new(Expr::Lit(Lit::Regex(Regex {
                span: DUMMY_SP,
                exp: Atom::new(pat.as_str()),
                flags: Atom::new(flags.as_str()),
            })));
            assign_stmt(i.dest, regex)
        }
        _ => {
            let ctor = Box::new(Expr::Ident(Ident::new_no_ctxt("RegExp".into(), DUMMY_SP)));
            let new_expr = Box::new(Expr::New(NewExpr {
                span: DUMMY_SP,
                callee: ctor,
                args: Some(vec![
                    ExprOrSpread {
                        spread: None,
                        expr: value_expr(&i.pattern),
                    },
                    ExprOrSpread {
                        spread: None,
                        expr: value_expr(&i.flags),
                    },
                ]),
                type_args: None,
                ctxt: SyntaxContext::default(),
            }));
            assign_stmt(i.dest, new_expr)
        }
    }
}

// dest = value
pub fn lift_mov(i: &MovInstruction) -> Stmt {
    assign_stmt(i.dest, value_expr(&i.value))
}

pub fn lift_apply(i: &ApplyInstruction) -> Stmt {
    let apply_method = computed_member(value_expr(&i.function), str_lit("apply"));
    let args_array = Box::new(Expr::Array(ArrayLit {
        span: DUMMY_SP,
        elems: i
            .args
            .iter()
            .map(|&r| {
                Some(ExprOrSpread {
                    spread: None,
                    expr: reg_expr(r),
                })
            })
            .collect(),
    }));
    assign_stmt(
        i.dest,
        call_expr(apply_method, vec![null_lit(), args_array]),
    )
}

// dest = performance.now()
pub fn lift_perf(i: &PerfInstruction) -> Stmt {
    let perf = Box::new(Expr::Ident(Ident::new_no_ctxt(
        "performance".into(),
        DUMMY_SP,
    )));
    let now_method = computed_member(perf, str_lit("now"));
    assign_stmt(i.dest, call_expr(now_method, vec![]))
}

// dest = Math.trunc(performance.now())
pub fn lift_math_trunc(i: &MathTruncInstruction) -> Stmt {
    let math = Box::new(Expr::Ident(Ident::new_no_ctxt("Math".into(), DUMMY_SP)));
    let trunc_method = computed_member(math, str_lit("trunc"));
    let perf = Box::new(Expr::Ident(Ident::new_no_ctxt(
        "performance".into(),
        DUMMY_SP,
    )));
    let now_method = computed_member(perf, str_lit("now"));
    let inner = call_expr(now_method, vec![]);
    assign_stmt(i.dest, call_expr(trunc_method, vec![inner]))
}

pub fn lift_bind_apply(i: &BindApplyInstruction) -> Stmt {
    let fn_proto_bind = {
        let fn_ident = Box::new(Expr::Ident(Ident::new_no_ctxt("Function".into(), DUMMY_SP)));
        let proto = computed_member(fn_ident, str_lit("prototype"));
        computed_member(proto, str_lit("bind"))
    };
    let apply_method = computed_member(fn_proto_bind, str_lit("apply"));

    let mut elems: Vec<Option<ExprOrSpread>> = vec![Some(ExprOrSpread {
        spread: None,
        expr: null_lit(),
    })];
    elems.extend(i.args.iter().map(|&r| {
        Some(ExprOrSpread {
            spread: None,
            expr: reg_expr(r),
        })
    }));

    let bind_args_array = Box::new(Expr::Array(ArrayLit {
        span: DUMMY_SP,
        elems,
    }));
    let bound = call_expr(apply_method, vec![value_expr(&i.this), bind_args_array]);
    let new_expr = Box::new(Expr::New(NewExpr {
        span: DUMMY_SP,
        callee: bound,
        args: Some(vec![]),
        type_args: None,
        ctxt: SyntaxContext::default(),
    }));
    assign_stmt(i.dest, new_expr)
}

// concat dest = lhs + rhs
pub fn lift_concat(i: &ConcatInstruction) -> Stmt {
    assign_stmt(
        i.dest,
        binary_expr(BinaryOp::Add, value_expr(&i.lhs), value_expr(&i.rhs)),
    )
}

// dest = __hash(value, seed)
pub fn lift_hash(i: &HashInstruction) -> Stmt {
    let callee = Box::new(Expr::Ident(Ident::new_no_ctxt("__hash".into(), DUMMY_SP)));
    assign_stmt(
        i.dest,
        call_expr(callee, vec![value_expr(&i.value), value_expr(&i.seed)]),
    )
}

// dest = "" + value
pub fn lift_serial_to_str(i: &SerialToStrInstruction) -> Stmt {
    assign_stmt(
        i.dest,
        binary_expr(BinaryOp::Add, str_lit(""), value_expr(&i.value)),
    )
}

//  dest = !value
pub fn lift_not(i: &NotInstruction) -> Stmt {
    assign_stmt(
        i.dest,
        Box::new(Expr::Unary(UnaryExpr {
            span: DUMMY_SP,
            op: UnaryOp::Bang,
            arg: value_expr(&i.value),
        })),
    )
}

// dest = typeof value
pub fn lift_typeof(i: &TypeofInstruction) -> Stmt {
    assign_stmt(
        i.dest,
        Box::new(Expr::Unary(UnaryExpr {
            span: DUMMY_SP,
            op: UnaryOp::TypeOf,
            arg: value_expr(&i.value),
        })),
    )
}

// __send(r0, r1, r2, …)
pub fn lift_send(i: &SendInstruction) -> Stmt {
    let callee = Box::new(Expr::Ident(Ident::new_no_ctxt("__send".into(), DUMMY_SP)));
    let args: Vec<Box<Expr>> = i.values.iter().map(|&r| reg_expr(r)).collect();
    expr_stmt(call_expr(callee, args))
}

pub fn lift_unknown_op(i: &UnknownOpInstruction) -> Stmt {
    let callee = Box::new(Expr::Ident(Ident::new_no_ctxt(
        "__unknown_op".into(),
        DUMMY_SP,
    )));
    expr_stmt(call_expr(callee, vec![value_expr(&i.value)]))
}

pub struct BlockLifter;

impl BlockLifter {
    pub fn lift_stmts(instructions: &[InstructionBase<Instruction>]) -> Vec<Stmt> {
        instructions.iter().filter_map(Self::lift_one).collect()
    }

    fn lift_one(ib: &InstructionBase<Instruction>) -> Option<Stmt> {
        match &ib.inner {
            Instruction::LoadConst(i) => Some(lift_load_const(i)),
            Instruction::Binary(i) => Some(lift_binary(i)),
            Instruction::Concat(i) => Some(lift_concat(i)),
            Instruction::Not(i) => Some(lift_not(i)),
            Instruction::Typeof(i) => Some(lift_typeof(i)),
            Instruction::Mov(i) => Some(lift_mov(i)),
            Instruction::Null(i) => Some(lift_null(i)),
            Instruction::StrToBytes(i) => Some(lift_str_to_bytes(i)),
            Instruction::StrDec(i) => Some(lift_str_dec(i)),
            Instruction::SerialToStr(i) => Some(lift_serial_to_str(i)),
            Instruction::Hash(i) => Some(lift_hash(i)),
            Instruction::GetProp(i) => Some(lift_get_prop(i)),
            Instruction::SetProp(i) => Some(lift_set_prop(i)),
            Instruction::GetWindowProp(i) => Some(lift_get_window_prop(i)),
            Instruction::SetWindowProp(i) => Some(lift_set_window_prop(i)),
            Instruction::CallMethod(i) => Some(lift_call_method(i)),
            Instruction::CallWindowProp(i) => Some(lift_call_window_prop(i)),
            Instruction::Apply(i) => Some(lift_apply(i)),
            Instruction::BindApply(i) => Some(lift_bind_apply(i)),
            Instruction::Regexp(i) => Some(lift_regexp(i)),
            Instruction::Perf(i) => Some(lift_perf(i)),
            Instruction::MathTrunc(i) => Some(lift_math_trunc(i)),
            Instruction::Send(i) => Some(lift_send(i)),
            Instruction::UnknownOp(i) => Some(lift_unknown_op(i)),
            Instruction::Jump(_) | Instruction::JumpIfEq(_) | Instruction::JumpIfLt(_) => None,
            Instruction::NewFunction(_) | Instruction::Disposer(_) => None,
        }
    }
}
